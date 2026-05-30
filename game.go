package main

import (
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"net/http"
	"strings"
	"sync"
)

var (
	gameMutex             sync.Mutex
	state                 GameState
	activePitch           *ActivePitch
	lastCPUPitchType      string
	consecutivePitchCount int
)

type Score struct {
	Player int `json:"player"`
	CPU    int `json:"cpu"`
}

type InningRuns struct {
	Player []interface{} `json:"player"`
	CPU    []interface{} `json:"cpu"`
}

type GameState struct {
	CurrentScreen         string         `json:"currentScreen"`
	Difficulty            string         `json:"difficulty"`
	MaxInnings            int            `json:"maxInnings"`
	Inning                int            `json:"inning"`
	IsBottom              bool           `json:"isBottom"`
	Score                 Score          `json:"score"`
	InningRuns            InningRuns     `json:"inningRuns"`
	Balls                 int            `json:"balls"`
	Strikes               int            `json:"strikes"`
	Outs                  int            `json:"outs"`
	Runners               [3]bool        `json:"runners"`
	CPULineup             []CPUCharacter `json:"cpuLineup"`
	CurrentCPUBatterIndex int            `json:"currentCpuBatterIndex"`
	CPUPitcher            *CPUCharacter  `json:"cpuPitcher"`
	UserPitchSpeed        string         `json:"userPitchSpeed"`
	PlayerCondition       string         `json:"playerCondition"`
	CPUBatterCondition    string         `json:"cpuBatterCondition"`
	GameMode              string         `json:"gameMode"`
	TournamentStage       int            `json:"tournamentStage"`
}

type ActivePitch struct {
	Type     string  `json:"type"`
	Duration float64 `json:"duration"`
	MinSweet float64 `json:"minSweet"`
	MaxSweet float64 `json:"maxSweet"`
	IsStrike bool    `json:"isStrike"`
	Guess    string  `json:"guess"`
}

func rollCondition() string {
	r := rand.Float64()
	if r < 0.15 {
		return "super_hot"
	} else if r < 0.40 {
		return "hot"
	} else if r < 0.80 {
		return "normal"
	} else {
		return "cold"
	}
}

var Difficulties = map[string]struct {
	Name          string  `json:"name"`
	StrikeRate    float64 `json:"strikeRate"`
	SwingAtStrike float64 `json:"swingAtStrike"`
	SwingAtBall   float64 `json:"swingAtBall"`
	CPUMissRate   float64 `json:"cpuMissRate"`
}{
	"easy":   {Name: "かんたん", StrikeRate: 0.70, SwingAtStrike: 0.60, SwingAtBall: 0.45, CPUMissRate: 0.40},
	"medium": {Name: "ふつう", StrikeRate: 0.55, SwingAtStrike: 0.78, SwingAtBall: 0.25, CPUMissRate: 0.20},
	"hard":   {Name: "むずかしい", StrikeRate: 0.40, SwingAtStrike: 0.90, SwingAtBall: 0.05, CPUMissRate: 0.05},
}

type PitchParam struct {
	Name     string  `json:"name"`
	Duration float64 `json:"duration"`
	MinSweet float64 `json:"minSweet"`
	MaxSweet float64 `json:"maxSweet"`
}

var PitchTypes = map[string]PitchParam{
	"fastball": {Name: "ストレート", Duration: 800, MinSweet: 550, MaxSweet: 720},
	"curve":    {Name: "カーブ", Duration: 1200, MinSweet: 900, MaxSweet: 1100},
	"changeup": {Name: "チェンジアップ", Duration: 1600, MinSweet: 1300, MaxSweet: 1500},
	"fork":     {Name: "フォーク", Duration: 1100, MinSweet: 800, MaxSweet: 980},
	"split":    {Name: "スプリット", Duration: 900, MinSweet: 650, MaxSweet: 810},
	"screw":    {Name: "スクリュー", Duration: 1300, MinSweet: 950, MaxSweet: 1150},
}

func initGame(difficulty string, maxInnings int, gameMode string, stage int) {
	state.CurrentScreen = "game"
	state.Difficulty = difficulty
	state.MaxInnings = maxInnings
	state.Inning = 1
	state.IsBottom = false
	state.Score = Score{Player: 0, CPU: 0}
	state.PlayerCondition = rollCondition()
	state.CPUBatterCondition = rollCondition()

	runsListPlayer := make([]interface{}, maxInnings)
	runsListCPU := make([]interface{}, maxInnings)
	for i := 0; i < maxInnings; i++ {
		runsListPlayer[i] = "-"
		runsListCPU[i] = "-"
	}
	state.InningRuns = InningRuns{
		Player: runsListPlayer,
		CPU:    runsListCPU,
	}

	// CPU Lineup
	shuffled := make([]CPUCharacter, len(CPU_CHARACTERS))
	copy(shuffled, CPU_CHARACTERS)
	rand.Shuffle(len(shuffled), func(i, j int) {
		shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
	})
	state.CPULineup = shuffled
	state.CurrentCPUBatterIndex = 0

	// CPU Pitcher
	state.CPUPitcher = &CPU_CHARACTERS[rand.Intn(len(CPU_CHARACTERS))]

	state.UserPitchSpeed = "normal"
	state.GameMode = gameMode
	state.TournamentStage = stage

	initHalfInning()
	activePitch = nil
}

func initHalfInning() {
	state.Balls = 0
	state.Strikes = 0
	state.Outs = 0
	state.Runners = [3]bool{false, false, false}
}

func getClutchPitch(id string) string {
	switch id {
	case "kikiriki", "ooabare", "okane", "kowai_l":
		return "fastball" // 豪速球・強打・せっかち
	case "kayui", "tonton", "batabata":
		return "split" // 細かいブレ・スプリット
	case "maigo", "pokapoka", "card":
		return "screw" // 迷子・予測不能・スクリュー
	case "hippari", "lovelove":
		return "curve" // カーブ
	case "iiiiiiiii", "minus", "ofuton", "amaenbo":
		return "fork" // フォーク・遅球・沈む
	default:
		return "fastball"
	}
}

func prepareCPUPitch(guess string) (*ActivePitch, string, PitchParam) {
	diff := Difficulties[state.Difficulty]
	pitcher := state.CPUPitcher

	// 新しい打席（ボールカウント、ストライアカウントがともに0）の開始時に連続球種履歴をリセット
	if state.Balls == 0 && state.Strikes == 0 {
		lastCPUPitchType = ""
		consecutivePitchCount = 0
	}

	sRate := diff.StrikeRate
	if pitcher.StrikeRate != 0 {
		sRate = pitcher.StrikeRate
	}

	if state.Difficulty == "easy" {
		sRate = sRate + 0.15
		if sRate > 0.85 {
			sRate = 0.85
		}
	} else if state.Difficulty == "hard" {
		sRate = sRate - 0.15
		if sRate < 0.35 {
			sRate = 0.35
		}
	}

	isStrike := rand.Float64() < sRate

	pitchKeys := []string{"fastball", "curve", "changeup", "fork", "split", "screw"}
	pitchType := pitchKeys[rand.Intn(len(pitchKeys))]

	// 得点圏ピンチ時の勝負球（決め球）の確率アップ
	isClutchSituation := state.Runners[1] || state.Runners[2]
	clutchText := ""

	if state.GameMode == "timing_practice" {
		// チャレンジ：タイミング測定器では、必ずストレート（ストライク）を投げる
		pitchType = "fastball"
		isStrike = true
	} else if isClutchSituation && rand.Float64() < 0.65 {
		pitchType = getClutchPitch(pitcher.ID)
		clutchText = fmt.Sprintf("【勝負の一球！】ピンチの場面、%sは得意の『%s』で仕留めに来た！ ", pitcher.Name, PitchTypes[pitchType].Name)
	} else {
		// 通常時の「クセ」傾向
		if pitcher.LowPitchesOnly {
			if rand.Float64() < 0.7 {
				pitchType = "changeup"
			} else {
				pitchType = "curve"
			}
		} else if pitcher.SawNoise || pitcher.RageMode || pitcher.SpendAll {
			if rand.Float64() < 0.7 {
				pitchType = "fastball"
			}
		} else if pitcher.AnnoyingChangeup {
			pitchType = "changeup"
		}
	}

	// 連続投球の追跡
	if pitchType == lastCPUPitchType {
		consecutivePitchCount++
	} else {
		lastCPUPitchType = pitchType
		consecutivePitchCount = 1
	}

	param := PitchTypes[pitchType]
	speedMod := 1.0
	if pitcher.PitchSpeedMod != 0 {
		speedMod = pitcher.PitchSpeedMod
	}

	duration := param.Duration * speedMod
	minSweet := param.MinSweet * speedMod
	maxSweet := param.MaxSweet * speedMod

	activePitch = &ActivePitch{
		Type:     pitchType,
		Duration: duration,
		MinSweet: minSweet,
		MaxSweet: maxSweet,
		IsStrike: isStrike,
		Guess:    guess,
	}

	// 狙い打ち（Guess）によるスイートエリア補正
	if guess != "" {
		width := maxSweet - minSweet
		center := (minSweet + maxSweet) / 2.0
		if guess == pitchType {
			// 狙い通り：スイートエリア30%拡大
			minSweet = center - (width * 1.30 / 2.0)
			maxSweet = center + (width * 1.30 / 2.0)
		} else {
			// 狙いハズレ：スイートエリア25%縮小
			minSweet = center - (width * 0.75 / 2.0)
			maxSweet = center + (width * 0.75 / 2.0)
		}
	}

	// 連続投球によるスイートエリア拡大（プレイヤーが打ち返しやすくなる）
	if !state.IsBottom && consecutivePitchCount >= 2 {
		condMod := 1.0
		if consecutivePitchCount == 2 {
			condMod = 1.15 // 15%拡大
		} else if consecutivePitchCount >= 3 {
			condMod = 1.30 // 30%拡大
		}
		width := maxSweet - minSweet
		center := (minSweet + maxSweet) / 2.0
		minSweet = center - (width * condMod / 2.0)
		maxSweet = center + (width * condMod / 2.0)
	}

	// プレイヤーバッターの調子（Condition）によるスイートエリア補正
	if !state.IsBottom {
		width := maxSweet - minSweet
		center := (minSweet + maxSweet) / 2.0
		condMod := 1.0
		switch state.PlayerCondition {
		case "super_hot":
			condMod = 1.18
		case "hot":
			condMod = 1.08
		case "cold":
			condMod = 0.85
		}
		minSweet = center - (width * condMod / 2.0)
		maxSweet = center + (width * condMod / 2.0)
	}

	activePitch.MinSweet = minSweet
	activePitch.MaxSweet = maxSweet

	pitchText := pitcher.PitchText
	if pitchText == "" {
		pitchText = pitcher.Name + "が投げました！"
	}

	// 同じ球種の連続に関する実況アナウンス追加
	if !state.IsBottom && consecutivePitchCount >= 2 {
		hint := ""
		if consecutivePitchCount == 2 {
			hint = fmt.Sprintf("【狙い目！】相手投手は2球連続で『%s』を選択！球種が読めてきました！ ", param.Name)
		} else if consecutivePitchCount >= 3 {
			hint = fmt.Sprintf("【大チャンス！】相手投手はなんと%d球連続で『%s』！完全にクセを見抜かれています！ ", consecutivePitchCount, param.Name)
		}
		pitchText = hint + pitchText
	}

	// 最終回逆転チャンス演出
	dramaticText := ""
	if state.Inning == state.MaxInnings {
		if state.Score.Player <= state.Score.CPU && (state.Outs == 2 || state.Runners[1] || state.Runners[2]) {
			dramaticText = "【劇的チャンス！】さあ最終回表、一打同点または逆転の絶好のチャンス！スタンドからは地鳴りのような大歓声が巻き起こっています！ "
		}
	}

	// プレイヤー代打イベント
	if state.Score.Player <= state.Score.CPU && (state.Runners[1] || state.Runners[2]) && rand.Float64() < 0.35 {
		state.PlayerCondition = "super_hot"
		width := maxSweet - minSweet
		center := (minSweet + maxSweet) / 2.0
		minSweet = center - (width * 1.18 / 2.0)
		maxSweet = center + (width * 1.18 / 2.0)
		activePitch.MinSweet = minSweet
		activePitch.MaxSweet = maxSweet
		
		dramaticText += "【ここで代打！】 監督が決断！ここでバッターボックスに伝説の強打者『レジェンド星人』が登場！絶好調のオーラを纏って打席に入ります！ "
	}

	pitchText = dramaticText + clutchText + pitchText

	return activePitch, pitchText, PitchParam{
		Name:     param.Name,
		Duration: duration,
		MinSweet: minSweet,
		MaxSweet: maxSweet,
	}
}

type StartGameRequest struct {
	Difficulty string `json:"difficulty"`
	MaxInnings int    `json:"maxInnings"`
	GameMode   string `json:"gameMode"`
	Stage      int    `json:"stage"`
}

type PrepareResponse struct {
	PitchType string     `json:"pitchType"`
	IsStrike  bool       `json:"isStrike"`
	Duration  float64    `json:"duration"`
	MinSweet  float64    `json:"minSweet"`
	MaxSweet  float64    `json:"maxSweet"`
	PitchText string     `json:"pitchText"`
	ParamName string     `json:"paramName"`
}

type SwingRequest struct {
	Elapsed float64 `json:"elapsed"`
}

type SwingResponse struct {
	Result       string    `json:"result"`
	Bases        int       `json:"bases"`
	Message      string    `json:"message"`
	HitDirection string    `json:"hitDirection"`
	HitType      string    `json:"hitType"`
	State        GameState `json:"state"`
}

type ThrowRequest struct {
	PitchType  string `json:"pitchType"`
	PitchLoc   string `json:"pitchLoc"`
	PitchSpeed string `json:"pitchSpeed"`
}

type ThrowResponse struct {
	CPUSwings    bool      `json:"cpuSwings"`
	CPUMisses    bool      `json:"cpuMisses"`
	Result       string    `json:"result"`
	Bases        int       `json:"bases"`
	Message      string    `json:"message"`
	HitDirection string    `json:"hitDirection"`
	HitType      string    `json:"hitType"`
	State        GameState `json:"state"`
}

func processSwing(elapsed float64) SwingResponse {
	if activePitch == nil {
		return SwingResponse{Result: "error", Message: "現在飛行中の投球がありません", State: state}
	}

	pitch := *activePitch
	activePitch = nil

	result := ""
	bases := 0
	message := ""
	var hitDirection, hitType string

	pMin := pitch.MinSweet
	pMax := pitch.MaxSweet

	// プレイヤーバッターの調子による打撃精度補正
	accuracyMod := 0.0
	if !state.IsBottom {
		switch state.PlayerCondition {
		case "super_hot":
			accuracyMod = 0.08
		case "hot":
			accuracyMod = 0.04
		case "cold":
			accuracyMod = -0.08
		}
	}

	if pitch.IsStrike {
		if elapsed >= pMin && elapsed <= pMax {
			center := (pMin + pMax) / 2
			maxDiff := (pMax - pMin) / 2
			accuracy := 1.0
			if maxDiff > 0 {
				accuracy = 1.0 - (math.Abs(elapsed-center) / maxDiff)
			}
			accuracy += accuracyMod
			if accuracy > 1.0 {
				accuracy = 1.0
			} else if accuracy < 0.0 {
				accuracy = 0.0
			}
			result, bases, message, hitDirection, hitType = processHitResult(accuracy)
		} else {
			reason := "スイングが遅すぎます！"
			if elapsed < pMin {
				reason = "スイングが早すぎます！"
			}
			result, message = processStrike("空振りストライク！ " + reason)
			hitType = "strike"
		}
	} else {
		if elapsed >= pMin && elapsed <= pMax {
			if rand.Float64() < 0.6 {
				result, message = processFoul("ボール球に手を出してしまいました。ファウル。")
				hitType = "foul"
				hitDirection = "left"
				if rand.Float64() < 0.5 {
					hitDirection = "right"
				}
			} else {
				ballOutTypes := []struct {
					msg string
					dir string
					typ string
				}{
					{"ボール球を打たされてサードゴロ、アウト！", "left", "grounder"},
					{"詰まった当たりはファーストゴロ、アウト！", "right", "grounder"},
					{"泳がされてボテボテのピッチャーゴロ、アウト！", "center", "grounder"},
					{"ひっかけた当たりはショートゴロ、アウト！", "left", "grounder"},
					{"ひっかけたボテボテのセカンドゴロ、アウト！", "right", "grounder"},
					{"力んで打ち上げてしまった、ピッチャーフライでアウト！", "center", "popup"},
					{"詰まった当たりのサードフライ、アウト！", "left", "popup"},
					{"押し込まれてファーストへのポップフライ、アウト！", "right", "popup"},
					{"バットの先でセカンドへの力のないフライ、アウト！", "right", "popup"},
					{"ボール球に手を出し、強引に引っ張ったがレフトフライ、アウト！", "left", "flyout"},
					{"逆らわずに流したが力なくライトフライ、アウト！", "right", "flyout"},
					{"力んでこすりあげた打球はセンターへの平凡なフライ、アウト！", "center", "flyout"},
					{"バットの先で引っかけたショートライナー、正面でアウト！", "left", "liner"},
					{"押し込まれた打球はセカンドライナー、正面でアウト！", "right", "liner"},
				}
				bot := ballOutTypes[rand.Intn(len(ballOutTypes))]
				result, message = processOut(bot.msg)
				hitType = bot.typ
				hitDirection = bot.dir
			}
		} else {
			result, message = processStrike("空振りストライク。 ボール球を振ってしまいました！")
			hitType = "strike"
		}
	}

	// 狙い打ちの成否フィードバックメッセージを追記
	if pitch.Guess != "" && !state.IsBottom {
		if pitch.Guess == pitch.Type {
			message = "【狙い打ち大成功！】 " + message
		} else {
			message = "【狙いハズレ！】 " + message
		}
	}

	// 三振アウトの場合に hitType を strikeout にする
	if result == "out_change" || result == "out" {
		if strings.Contains(message, "三振") {
			hitType = "strikeout"
		}
	}

	return SwingResponse{
		Result:       result,
		Bases:        bases,
		Message:      message,
		HitDirection: hitDirection,
		HitType:      hitType,
		State:        state,
	}
}

func processTake() SwingResponse {
	if activePitch == nil {
		return SwingResponse{Result: "error", Message: "現在飛行中の投球がありません", State: state}
	}

	pitch := *activePitch
	activePitch = nil

	result := ""
	message := ""

	if pitch.IsStrike {
		result, message = processStrike("見送りストライク！")
	} else {
		result, message = processBall("見送ってボール！")
	}

	hitType := "take_ball"
	if pitch.IsStrike {
		hitType = "take_strike"
		if strings.Contains(message, "三振") {
			hitType = "strikeout"
		}
	} else if result == "walk" {
		hitType = "walk"
	}

	return SwingResponse{
		Result:       result,
		Message:      message,
		HitDirection: "",
		HitType:      hitType,
		State:        state,
	}
}

func processHitResult(accuracy float64) (string, int, string, string, string) {
	directionRoll := rand.Float64()
	var hitDirection string
	if directionRoll < 0.33 {
		hitDirection = "left"
	} else if directionRoll < 0.66 {
		hitDirection = "center"
	} else {
		hitDirection = "right"
	}

	if accuracy >= 0.82 {
		runs, _ := processHomerun()
		var hmsg string
		if hitDirection == "left" {
			hmsg = "左中間スタンド深くへ突き刺さった！"
		} else if hitDirection == "right" {
			hmsg = "ライトスタンドへの大飛球、入った！"
		} else {
			hmsg = "バックスクリーンへ一直線！"
		}
		
		distance := 105 + rand.Intn(35)
		finalMsg := fmt.Sprintf("%sホームラン！ 打ったー！大きい！（飛距離 %d メートル）", hmsg, distance)
		if runs == 4 {
			finalMsg = fmt.Sprintf("%s満塁ホームラン！！グランドスラムだ！ 打ったー！大きい！なんという大飛球！（飛距離 %d メートル）", hmsg, distance)
		}
		
		return "homerun", runs, finalMsg, hitDirection, "homerun"
	} else if accuracy >= 0.6 {
		if rand.Float64() < 0.25 {
			var directionMsg string
			if hitDirection == "left" {
				directionMsg = "レフト線を鋭く破った！"
			} else if hitDirection == "right" {
				directionMsg = "ライト線を真っ二つ！"
			} else {
				directionMsg = "センターオーバーの大飛球！"
			}
			msg := processBaseHit(3, "痛烈な打球が"+directionMsg+"スリーベースヒット！")
			return "hit", 3, msg, hitDirection, "triple"
		} else {
			var directionMsg string
			if hitDirection == "left" {
				directionMsg = "左中間を真っ二つに破る"
			} else if hitDirection == "right" {
				directionMsg = "右中間を真っ二つに破る"
			} else {
				directionMsg = "センター頭上を越える"
			}
			msg := processBaseHit(2, directionMsg+"ツーベースヒット！")
			return "hit", 2, msg, hitDirection, "double"
		}
	} else if accuracy >= 0.3 {
		var directionMsg string
		if hitDirection == "left" {
			directionMsg = "レフト前へのクリーンヒット！"
		} else if hitDirection == "right" {
			directionMsg = "ライト前へのクリーンヒット！"
		} else {
			directionMsg = "センター前へのクリーンヒット！"
		}
		msg := processBaseHit(1, directionMsg)
		return "hit", 1, msg, hitDirection, "single"
	} else {
		if rand.Float64() < 0.6 {
			_, msg := processFoul("当たりが薄い。ファウルボール。")
			foulDir := "left"
			if rand.Float64() < 0.5 {
				foulDir = "right"
			}
			return "foul", 0, msg, foulDir, "foul"
		} else {
			// 15% の確率で内野安打
			if rand.Float64() < 0.15 {
				infieldHitTypes := []struct {
					msg string
					dir string
				}{
					{"ボテボテのサードゴロ！しかしバッターランナーが俊足を飛ばして一塁セーフ！内野安打！", "left"},
					{"ピッチャーへのボテボテのゴロ！投手が一塁へ送球するも間に合わずセーフ！内野安打！", "center"},
					{"ショート深い位置へのゴロ！ショートが捕球して一塁へ送球するもセーフ！内野安打！", "left"},
					{"二遊間へのゴロをセカンドが滑り込んで捕球するが一塁送球間に合わず！内野安打！", "right"},
					{"ボテボテのファーストゴロ！投手が一塁ベースカバーに走るもバッターランナーの足が勝ってセーフ！内野安打！", "right"},
				}
				ih := infieldHitTypes[rand.Intn(len(infieldHitTypes))]
				msg := processBaseHit(1, ih.msg)
				return "hit", 1, msg, ih.dir, "single"
			}

			outTypes := []struct {
				msg string
				dir string
				typ string
			}{
				{"打ち上げてしまった、ピッチャーフライでアウト！", "center", "popup"},
				{"ボテボテの当たり、サードゴロでアウト！", "left", "grounder"},
				{"ボテボテの当たり、ファーストゴロでアウト！", "right", "grounder"},
				{"鋭いあたりもショート正面、ライナーでアウト！", "left", "liner"},
				{"鋭いあたりもセカンド正面、ライナーでアウト！", "right", "liner"},
				{"レフトへの平凡なフライ、掴んでアウト！", "left", "flyout"},
				{"ライトへの平凡なフライ、掴んでアウト！", "right", "flyout"},
				{"センターへの大きなフライ、追いついてアウト！", "center", "flyout"},
				{"高々と上がったサードフライ、サードがガッチリ掴んでアウト！", "left", "popup"},
				{"キャッチャー後方のファウルフライ、キャッチャーがマスクを脱ぎ捨ててキャッチ！アウト！", "center", "popup"},
				{"ファーストへのポップフライ、ファーストが掴んでアウト！", "right", "popup"},
				{"セカンドへのポップフライ、セカンドが落ち着いてキャッチ！アウト！", "right", "popup"},
				{"ショート後方のフライ、ショートが懸命に背走してキャッチ！アウト！", "left", "flyout"},
				{"左中間へのフライ、レフトがスライディングキャッチしてアウト！", "left", "flyout"},
				{"右中間への深いフライ、ライトがフェンス手前で追いついてアウト！", "right", "flyout"},
				{"センター後方への大飛球！センターがフェンスに激突しながらもキャッチしてアウト！ファインプレー！", "center", "flyout"},
			}
			ot := outTypes[rand.Intn(len(outTypes))]
			_, msg := processOut(ot.msg)
			return "out", 0, msg, ot.dir, ot.typ
		}
	}
}

func processStrike(message string) (string, string) {
	state.Strikes++
	if state.Strikes >= 3 {
		var outMsg string
		if state.IsBottom {
			batter := state.CPULineup[state.CurrentCPUBatterIndex]
			outMsg = "バッター三振！アウト！"
			if batter.ID == "kowai_l" {
				outMsg = "怖い星人（Lサイズ）は「タッチすんなぁ！」と怒り叫び、あなた（投手）を「たかいたかーい」と抱え上げてからベンチに戻りました！三振アウト！"
			} else if batter.CryBaby {
				outMsg = "アマエンボ星人は「ふえぇん！」と大泣きしながらベンチに戻っていきました。三振アウト！"
			} else if batter.HeavySleep {
				outMsg = "お布団星人はお布団のぬくもりから起き上がれないようベルトで縛られたまま、見送り三振アウト！"
			} else if batter.ID == "fukufuku" {
				outMsg = "服服星人は脱いだ服を探すのに夢中でバットを振るのを忘れました！三振アウト！"
			}
		} else {
			outMsg = "三振！アウト！"
		}
		res, outMsg2 := processOut(outMsg)
		
		strikeMessage := message
		if strings.Contains(message, "空振りストライク") {
			strikeMessage = message + " アウト！"
		}
		
		return res, strikeMessage + "  " + outMsg2
	}
	return "strike", message + " カウントは" + formatCount() + "。"
}

func processBall(message string) (string, string) {
	state.Balls++
	if state.Balls >= 4 {
		_, walkMsg := processWalk()
		return "walk", message + "\n" + walkMsg
	}
	return "ball", message + " カウントは" + formatCount() + "。"
}

func processFoul(message string) (string, string) {
	if state.Strikes < 2 {
		state.Strikes++
	}
	return "foul", message + " カウントは" + formatCount() + "。"
}

func formatCount() string {
	return fmt.Sprintf("%dボール、%dストライク", state.Balls, state.Strikes)
}

func processOut(message string) (string, string) {
	state.Outs++
	state.Balls = 0
	state.Strikes = 0

	if state.Outs >= 3 {
		recordInningRuns()
		switchHalfInning()
		return "out_change", message + " 3アウトチェンジ！"
	} else {
		nextBatterAnnouncement := ""
		if state.IsBottom {
			state.CurrentCPUBatterIndex = (state.CurrentCPUBatterIndex + 1) % len(state.CPULineup)
			nextBatter := state.CPULineup[state.CurrentCPUBatterIndex]
			nextBatterAnnouncement = " 次の打者は、" + nextBatter.Name + " です。"
			state.CPUBatterCondition = rollCondition()
			nextBatterAnnouncement = checkAndApplyCPUPinchHitter(nextBatterAnnouncement)
		} else {
			state.PlayerCondition = rollCondition()
		}
		return "out", fmt.Sprintf("%s ワンアウト追加。これで%dアウト。%s", message, state.Outs, nextBatterAnnouncement)
	}
}

func processBaseHit(bases int, message string) string {
	runsScored := 0
	var newRunners [3]bool

	for i := 2; i >= 0; i-- {
		if state.Runners[i] {
			newPos := i + bases
			if newPos >= 3 {
				runsScored++
			} else {
				newRunners[newPos] = true
			}
		}
	}

	if bases >= 4 {
		runsScored++
	} else {
		newRunners[bases-1] = true
	}

	state.Runners = newRunners
	state.Balls = 0
	state.Strikes = 0

	// 打者が進塁したため、新バッターの調子をロール
	if !state.IsBottom {
		state.PlayerCondition = rollCondition()
	} else {
		state.CPUBatterCondition = rollCondition()
	}

	resultMsg := message
	if runsScored > 0 {
		addScore(runsScored)
		resultMsg += fmt.Sprintf(" ランナーが %d 人ホームイン！ %d点獲得。", runsScored, runsScored)
	}

	nextBatterAnnouncement := ""
	if state.IsBottom {
		state.CurrentCPUBatterIndex = (state.CurrentCPUBatterIndex + 1) % len(state.CPULineup)
		nextBatter := state.CPULineup[state.CurrentCPUBatterIndex]
		nextBatterAnnouncement = " 次の打者は、" + nextBatter.Name + " です。"
		nextBatterAnnouncement = checkAndApplyCPUPinchHitter(nextBatterAnnouncement)
	}

	return resultMsg + nextBatterAnnouncement
}

func processHomerun() (int, string) {
	runsScored := 1
	for _, r := range state.Runners {
		if r {
			runsScored++
		}
	}

	state.Runners = [3]bool{false, false, false}
	state.Balls = 0
	state.Strikes = 0
	addScore(runsScored)

	// 打者が生還したため、新バッターの調子をロール
	if !state.IsBottom {
		state.PlayerCondition = rollCondition()
	} else {
		state.CPUBatterCondition = rollCondition()
	}

	msg := "打ったー！これは大きい！ぐんぐん伸びてスタンドに突き刺さった！ホームラン！！"
	if runsScored == 4 {
		msg = "打ったー！大きい！なんと満塁ホームラン！！グランドスラムだ！"
	}

	if state.IsBottom {
		batter := state.CPULineup[state.CurrentCPUBatterIndex]
		flavor := batter.FlavorText
		if flavor == "" {
			flavor = "強烈な一撃！"
		}
		msg = batter.Name + "の打撃：" + flavor + " " + msg
	}

	nextBatterAnnouncement := ""
	if state.IsBottom {
		state.CurrentCPUBatterIndex = (state.CurrentCPUBatterIndex + 1) % len(state.CPULineup)
		nextBatter := state.CPULineup[state.CurrentCPUBatterIndex]
		nextBatterAnnouncement = " 次の打者は、" + nextBatter.Name + " です。"
		nextBatterAnnouncement = checkAndApplyCPUPinchHitter(nextBatterAnnouncement)
	}

	return runsScored, fmt.Sprintf("%s 一挙に %d 点追加！%s", msg, runsScored, nextBatterAnnouncement)
}

func processWalk() (string, string) {
	runsScored := 0
	newRunners := state.Runners

	if !newRunners[0] {
		newRunners[0] = true
	} else if !newRunners[1] {
		newRunners[1] = true
	} else if !newRunners[2] {
		newRunners[2] = true
	} else {
		runsScored = 1
	}

	state.Runners = newRunners
	state.Balls = 0
	state.Strikes = 0

	// 打者が四球で歩いたため、新バッターの調子をロール
	if !state.IsBottom {
		state.PlayerCondition = rollCondition()
	} else {
		state.CPUBatterCondition = rollCondition()
	}

	msg := "フォアボール！押し出しです。"
	if state.IsBottom {
		batter := state.CPULineup[state.CurrentCPUBatterIndex]
		msg = batter.Name + "はフォアボールを選びました。押し出しです。"
	}

	if runsScored > 0 {
		addScore(runsScored)
		msg += " 1点入りました！"
	} else {
		msg += " ランナーがそれぞれ進塁します。"
	}

	nextBatterAnnouncement := ""
	if state.IsBottom {
		state.CurrentCPUBatterIndex = (state.CurrentCPUBatterIndex + 1) % len(state.CPULineup)
		nextBatter := state.CPULineup[state.CurrentCPUBatterIndex]
		nextBatterAnnouncement = " 次の打者は、" + nextBatter.Name + " です。"
		nextBatterAnnouncement = checkAndApplyCPUPinchHitter(nextBatterAnnouncement)
	}

	return "walk", msg + nextBatterAnnouncement
}

func addScore(runs int) {
	if !state.IsBottom {
		state.Score.Player += runs
	} else {
		state.Score.CPU += runs
	}
}

func recordInningRuns() {
	idx := state.Inning - 1
	currentTotal := state.Score.Player
	runsList := &state.InningRuns.Player
	if state.IsBottom {
		currentTotal = state.Score.CPU
		runsList = &state.InningRuns.CPU
	}

	previousTotal := 0
	for i := 0; i < idx; i++ {
		if val, ok := (*runsList)[i].(int); ok {
			previousTotal += val
		}
	}

	(*runsList)[idx] = currentTotal - previousTotal
}

func changeCPUPitcher() {
	currentID := ""
	if state.CPUPitcher != nil {
		currentID = state.CPUPitcher.ID
	}
	
	var candidates []CPUCharacter
	for _, char := range CPU_CHARACTERS {
		if char.ID != currentID {
			candidates = append(candidates, char)
		}
	}
	
	if len(candidates) > 0 {
		newPitcher := candidates[rand.Intn(len(candidates))]
		state.CPUPitcher = &newPitcher
	}
}

func switchHalfInning() {
	if !state.IsBottom {
		state.IsBottom = true
		initHalfInning()
	} else {
		if state.Inning >= state.MaxInnings {
			state.CurrentScreen = "lobby"
		} else {
			state.Inning++
			state.IsBottom = false
			initHalfInning()

			// 3イニングごとにピッチャー交代（4回表、7回表などに入るとき）
			if (state.Inning-1)%3 == 0 {
				changeCPUPitcher()
			}
		}
	}
}

func processThrow(req ThrowRequest) ThrowResponse {
	isStrike := (req.PitchLoc == "strike-center")
	batter := state.CPULineup[state.CurrentCPUBatterIndex]

	swingChance := batter.SwingAtBall
	if isStrike {
		swingChance = batter.SwingAtStrike
	}

	if state.Difficulty == "easy" {
		if !isStrike {
			swingChance = swingChance + 0.15
			if swingChance > 0.85 {
				swingChance = 0.85
			}
		} else {
			swingChance = swingChance - 0.15
			if swingChance < 0.40 {
				swingChance = 0.40
			}
		}
	} else if state.Difficulty == "hard" {
		if !isStrike {
			swingChance = swingChance - 0.10
			if swingChance < 0.02 {
				swingChance = 0.02
			}
		} else {
			swingChance = swingChance + 0.10
			if swingChance > 0.98 {
				swingChance = 0.98
			}
		}
	}

	if state.Strikes == 2 && isStrike {
		swingChance = swingChance + 0.15
		if swingChance > 0.98 {
			swingChance = 0.98
		}
	}

	// CPUバッターの調子によるスイング確率補正
	switch state.CPUBatterCondition {
	case "super_hot":
		if isStrike {
			swingChance += 0.05
		} else {
			swingChance -= 0.05
		}
	case "cold":
		if isStrike {
			swingChance -= 0.08
		} else {
			swingChance += 0.08
		}
	}
	if swingChance > 0.98 {
		swingChance = 0.98
	} else if swingChance < 0.02 {
		swingChance = 0.02
	}

	cpuSwings := rand.Float64() < swingChance
	cpuMisses := false
	result := ""
	bases := 0
	message := ""
	var hitDirection, hitType string

	if cpuSwings {
		missChance := batter.CPUMissRate
		if state.Difficulty == "easy" {
			missChance = missChance + 0.15
			if missChance > 0.80 {
				missChance = 0.80
			}
		} else if state.Difficulty == "hard" {
			missChance = missChance - 0.08
			if missChance < 0.01 {
				missChance = 0.01
			}
		}

		if !isStrike {
			missChance = missChance * 3
			if missChance > 0.95 {
				missChance = 0.95
			}
		}

		// CPUバッターの調子によるミスカット（空振り）率補正
		switch state.CPUBatterCondition {
		case "super_hot":
			missChance -= 0.08
		case "hot":
			missChance -= 0.04
		case "cold":
			missChance += 0.12
		}
		if missChance < 0.01 {
			missChance = 0.01
		} else if missChance > 0.95 {
			missChance = 0.95
		}

		cpuMisses = rand.Float64() < missChance

		if cpuMisses {
			strMsg := batter.Name + "は空振りしました！ストライク！"
			if batter.GrumbleM {
				strMsg = "「なにすんねん！」と怒りながら" + batter.Name + "が空振り！ストライク！"
			} else if batter.CryBaby {
				strMsg = "「ふえぇん！」と泣きそうな顔で" + batter.Name + "が空振り！ストライク！"
			}
			result, message = processStrike(strMsg)
			hitType = "strike"
		} else {
			hitChance := 0.35
			if state.Difficulty == "easy" {
				hitChance = 0.22
			} else if state.Difficulty == "hard" {
				hitChance = 0.48
			}

			if batter.RageMode || batter.HeavyL {
				hitChance += 0.12
			}
			if batter.LowPitchesOnly || batter.CryBaby {
				hitChance -= 0.10
			}
			if !isStrike {
				hitChance *= 0.35
			}

			// CPUバッターの調子によるヒット確率補正
			switch state.CPUBatterCondition {
			case "super_hot":
				hitChance += 0.08
			case "hot":
				hitChance += 0.04
			case "cold":
				hitChance -= 0.08
			}

			isHit := rand.Float64() < hitChance

			if isHit {
				randVal := rand.Float64()
				hitBases := 1
				hitMsg := ""

				directionRoll := rand.Float64()
				if directionRoll < 0.33 {
					hitDirection = "left"
				} else if directionRoll < 0.66 {
					hitDirection = "center"
				} else {
					hitDirection = "right"
				}

				isExtraBase := (randVal < 0.35) || (isStrike && batter.SweetZone)

				if isExtraBase {
					if randVal < 0.15 || (batter.HeavyL && randVal < 0.4) {
						hitBases = 4
						hitType = "homerun"
					} else if randVal < 0.6 {
						hitBases = 2
						hitType = "double"
						var dirMsg string
						if hitDirection == "left" {
							dirMsg = "左中間を破る"
						} else if hitDirection == "right" {
							dirMsg = "右中間を破る"
						} else {
							dirMsg = "センターオーバーの"
						}
						hitMsg = batter.Name + "に" + dirMsg + "ツーベースヒットを浴びました！"
					} else {
						hitBases = 3
						hitType = "triple"
						var dirMsg string
						if hitDirection == "left" {
							dirMsg = "レフト線を破る"
						} else if hitDirection == "right" {
							dirMsg = "ライト線を破る"
						} else {
							dirMsg = "センター頭上を越える"
						}
						hitMsg = batter.Name + "に" + dirMsg + "スリーベースヒットを浴びました！"
					}
				} else {
					hitBases = 1
					hitType = "single"
					var dirMsg string
					if hitDirection == "left" {
						dirMsg = "レフト前への"
					} else if hitDirection == "right" {
						dirMsg = "ライト前への"
					} else {
						dirMsg = "センター前への"
					}
					hitMsg = batter.Name + "に" + dirMsg + "ヒットを打たれました！"
				}

				flavor := batter.FlavorText
				if flavor == "" {
					flavor = "鋭い打球が飛んだ！"
				}

				if hitBases == 4 {
					runs, _ := processHomerun()
					distance := 105 + rand.Intn(35)
					var hmsg string
					if hitDirection == "left" {
						hmsg = "左中間スタンド深くへ突き刺さった！"
					} else if hitDirection == "right" {
						hmsg = "ライトスタンドへの大飛球、入った！"
					} else {
						hmsg = "バックスクリーンへ一直線！"
					}
					
					finalHomerunMsg := fmt.Sprintf("%sの打撃：%s %sホームラン！ 打ったー！大きい！（飛距離 %d メートル） 一挙に %d 点追加！", batter.Name, flavor, hmsg, distance, runs)
					if runs == 4 {
						finalHomerunMsg = fmt.Sprintf("%sの打撃：%s %s満塁ホームラン！！グランドスラムだ！ 打ったー！大きい！なんという大飛球！（飛距離 %d メートル） 一挙に %d 点追加！", batter.Name, flavor, hmsg, distance, 4)
					}

					result = "homerun"
					bases = runs
					message = finalHomerunMsg
				} else {
					baseHitMsg := processBaseHit(hitBases, batter.Name+"の打撃："+flavor+" "+hitMsg)
					result = "hit"
					bases = hitBases
					message = baseHitMsg
				}
			} else {
				if rand.Float64() < 0.4 {
					result, message = processFoul(batter.Name + "はファウルボールを打ちました。")
					hitDirection = "left"
					if rand.Float64() < 0.5 {
						hitDirection = "right"
					}
					hitType = "foul"
				} else {
					if rand.Float64() < 0.15 {
						infieldHitTypes := []struct {
							msg string
							dir string
						}{
							{batter.Name + "はボテボテのサードゴロ！しかし快足を飛ばして一塁内野安打！", "left"},
							{batter.Name + "はピッチャーへのボテボテのゴロ！投手の一塁送球が間に合わず内野安打！", "center"},
							{batter.Name + "はショート深い位置へのゴロ！一塁へ滑り込みセーフ、内野安打！", "left"},
							{batter.Name + "は二遊間へのゴロ！セカンドが追いつくも送球できず内野安打！", "right"},
							{batter.Name + "はボテボテのファーストゴロ！投手のベースカバーが一瞬遅れてセーフ、内野安打！", "right"},
						}
						ih := infieldHitTypes[rand.Intn(len(infieldHitTypes))]
						result = "hit"
						bases = 1
						message = processBaseHit(1, batter.Name+"の打撃："+ih.msg)
						hitDirection = ih.dir
						hitType = "single"
					} else {
						outTypes := []struct {
							msg string
							dir string
							typ string
						}{
							{batter.Name + "はショートゴロ！アウト！", "left", "grounder"},
							{batter.Name + "はサードへのポップフライ！アウト！", "left", "popup"},
							{batter.Name + "はファーストゴロ！アウト！", "right", "grounder"},
							{batter.Name + "はセカンドゴロ！アウト！", "right", "grounder"},
							{batter.Name + "は力んでセンターフライ！アウト！", "center", "flyout"},
							{batter.Name + "はレフトフライ！アウト！", "left", "flyout"},
							{batter.Name + "はライトフライ！アウト！", "right", "flyout"},
							{batter.Name + "はキャッチャーフライ！アウト！", "center", "popup"},
							{batter.Name + "はピッチャーフライ！アウト！", "center", "popup"},
							{batter.Name + "の打球は高々と上がったサードフライ！サードが掴んでアウト！", "left", "popup"},
							{batter.Name + "はファーストへのポップフライ！ファーストが掴んでアウト！", "right", "popup"},
							{batter.Name + "はセカンドへのポップフライ！セカンドが落ち着いてキャッチ！アウト！", "right", "popup"},
							{batter.Name + "はショート後方のフライ！ショートが背走キャッチ、アウト！", "left", "flyout"},
							{batter.Name + "は左中間へのフライ！レフトがスライディングキャッチしてアウト！", "left", "flyout"},
							{batter.Name + "は右中間への深いフライ！ライトがフェンス手前で追いついてアウト！", "right", "flyout"},
							{batter.Name + "はセンター後方への大飛球！センターがフェンスに激突しながらもキャッチ、アウト！ファインプレー！", "center", "flyout"},
						}
						ot := outTypes[rand.Intn(len(outTypes))]
						result, message = processOut(ot.msg)
						hitDirection = ot.dir
						hitType = ot.typ
					}
				}
			}
		}
	} else {
		if isStrike {
			strikeText := batter.Name + "は見送りました。ストライク！"
			if batter.HeavySleep {
				strikeText = batter.Name + "はお布団星人のアホみたいに太いベルトで縛られたかのように身動きせず、見送りストライク！"
			}
			result, message = processStrike(strikeText)
			hitType = "take_strike"
		} else {
			result, message = processBall(batter.Name + "は見送りました。ボール。")
			hitType = "take_ball"
			if result == "walk" {
				hitType = "walk"
			}
		}
	}

	if result == "out_change" || result == "out" {
		if strings.Contains(message, "三振") {
			hitType = "strikeout"
		}
	}

	return ThrowResponse{
		CPUSwings:    cpuSwings,
		CPUMisses:    cpuMisses,
		Result:       result,
		Bases:        bases,
		Message:      message,
		HitDirection: hitDirection,
		HitType:      hitType,
		State:        state,
	}
}

func checkAndApplyCPUPinchHitter(message string) string {
	if !state.IsBottom {
		return message
	}

	isPinchHitterChance := (state.Runners[1] || state.Runners[2]) && (state.Score.CPU <= state.Score.Player)
	
	currentBatter := state.CPULineup[state.CurrentCPUBatterIndex]
	if isPinchHitterChance && currentBatter.ID != "mega_abare" && rand.Float64() < 0.40 {
		megaAbare := CPUCharacter{
			ID:            "mega_abare",
			Name:          "代打の切り札・メガ暴れ星人",
			Desc:          "怒りで通常の3倍のパワーを誇る、破壊的強打者のエイリアン。",
			PitchSpeedMod: 0.70,
			StrikeRate:    0.50,
			SwingAtStrike: 0.98,
			SwingAtBall:   0.45,
			CPUMissRate:   0.20,
			RageMode:      true,
			FlavorText:    "怒髪天を衝くメガ暴れスイング！凄まじい風切り音が響いた！",
			PitchText:     "メガ暴れ豪速球を投げました！",
		}
		
		state.CPULineup[state.CurrentCPUBatterIndex] = megaAbare
		state.CPUBatterCondition = "super_hot"
		
		pinchHitterAnn := "\n【CPUチーム代打起用！】ここでCPUチームが動いた！ベンチから不敵な笑みを浮かべた『代打の切り札・メガ暴れ星人』が乱入！絶好調のオーラを纏って打席に入ります！"
		
		if state.Inning == state.MaxInnings {
			pinchHitterAnn = "\n【劇的サヨナラのピンチ！】ここでCPUチームが動いた！ベンチから不敵な笑みを浮かべた『代打の切り札・メガ暴れ星人』がサヨナラの走者を背負って乱入！絶好調のオーラを纏って打席に入ります！"
		}
		
		return message + pinchHitterAnn
	}

	if state.Inning == state.MaxInnings && isPinchHitterChance {
		return message + " 【サヨナラの大ピンチ！】一打サヨナラ負けの緊迫した場面です！"
	}

	return message
}

// Handlers

func startHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req StartGameRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	gameMutex.Lock()
	defer gameMutex.Unlock()

	initGame(req.Difficulty, req.MaxInnings, req.GameMode, req.Stage)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"state":      state,
		"cpuPitcher": state.CPUPitcher,
	})
}

type PrepareRequest struct {
	Guess string `json:"guess"`
}

func preparePitchHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req PrepareRequest
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}

	gameMutex.Lock()
	defer gameMutex.Unlock()

	pitch, pitchText, param := prepareCPUPitch(req.Guess)

	res := PrepareResponse{
		PitchType: pitch.Type,
		IsStrike:  pitch.IsStrike,
		Duration:  pitch.Duration,
		MinSweet:  pitch.MinSweet,
		MaxSweet:  pitch.MaxSweet,
		PitchText: pitchText,
		ParamName: param.Name,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(res)
}

func swingHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req SwingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	gameMutex.Lock()
	defer gameMutex.Unlock()

	res := processSwing(req.Elapsed)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(res)
}

func takeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	gameMutex.Lock()
	defer gameMutex.Unlock()

	res := processTake()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(res)
}

func throwHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req ThrowRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	gameMutex.Lock()
	defer gameMutex.Unlock()

	res := processThrow(req)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(res)
}
