package main

import (
	"embed"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"time"
)

//go:embed frontend/*
var frontendFS embed.FS

func main() {
	// "frontend" ディレクトリの下のファイルを直接ルートとして公開するために fs.Sub を使用します
	subFS, err := fs.Sub(frontendFS, "frontend")
	if err != nil {
		fmt.Printf("エラー: 埋め込みファイルのサブディレクトリ作成に失敗しました: %v\n", err)
		os.Exit(1)
	}

	port := "8080"
	url := fmt.Sprintf("http://localhost:%s", port)

	// APIハンドラーの登録
	http.HandleFunc("/api/game/start", startHandler)
	http.HandleFunc("/api/pitch/prepare", preparePitchHandler)
	http.HandleFunc("/api/swing", swingHandler)
	http.HandleFunc("/api/take", takeHandler)
	http.HandleFunc("/api/pitch/throw", throwHandler)
	http.HandleFunc("/api/game/exit", exitHandler)

	// 静的ファイルサーバーの設定
	http.Handle("/", http.FileServer(http.FS(subFS)))

	fmt.Println("==================================================================")
	fmt.Println("  ユニバーサル・ベースボール (Universal Baseball) サーバー起動")
	fmt.Println("==================================================================")
	fmt.Println("  スクリーンリーダー対応の野球ゲームがバックエンドで稼働中...")
	fmt.Printf("  ブラウザで自動的に開かない場合は、こちらをクリックしてください: %s\n", url)
	fmt.Println("  サーバーを停止するには、このターミナルで Ctrl + C を押してください。")
	fmt.Println("==================================================================")

	// 少し待ってからブラウザを自動で開く
	go func() {
		time.Sleep(500 * time.Millisecond)
		openBrowser(url)
	}()

	// サーバーをリッスン開始
	err = http.ListenAndServe(":"+port, nil)
	if err != nil {
		fmt.Printf("エラー: ポート %s でのサーバー起動に失敗しました: %v\n", port, err)
		os.Exit(1)
	}
}

// OSごとにブラウザを開くコマンドを実行する
func openBrowser(url string) {
	var err error
	switch runtime.GOOS {
	case "linux":
		err = exec.Command("xdg-open", url).Start()
	case "windows":
		// Windows環境向けにブラウザを開くコマンド
		err = exec.Command("cmd", "/c", "start", url).Start()
	case "darwin":
		err = exec.Command("open", url).Start()
	default:
		err = fmt.Errorf("未対応のOSです: %s", runtime.GOOS)
	}

	if err != nil {
		fmt.Printf("ブラウザを自動で起動できませんでした。手動で開いてください。エラー: %v\n", err)
	}
}

// exitHandler はゲームセット時にフロントエンドからの要求を受けてサーバーを終了します
func exitHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"success"}`))

	go func() {
		time.Sleep(500 * time.Millisecond)
		fmt.Println("ゲーム終了リクエストを受信しました。サーバーを終了します。")
		os.Exit(0)
	}()
}
