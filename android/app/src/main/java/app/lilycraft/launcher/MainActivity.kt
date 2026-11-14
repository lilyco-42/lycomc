package app.lilycraft.launcher

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.view.KeyEvent
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * LilyCraft 安卓壳：唯一的职责是把 Rust 内核拉起来，然后用 WebView 打开它。
 *
 * 端口由内核自己挑（bind 127.0.0.1:0），Java 侧只拿到一个数字，
 * 用户界面上不会出现端口或 IP —— 与桌面端一致的产品规则。
 */
class MainActivity : Activity() {

    private lateinit var web: WebView

    /** Rust 侧 lycomc::lib 里的 Java_app_lilycraft_launcher_MainActivity_nativeStart。 */
    private external fun nativeStart(): Int

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        System.loadLibrary("lycomc")

        web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        web.webViewClient = WebViewClient()
        setContentView(web)

        // 内核已经在别的线程里跑 tokio，这里同步等待它返回实际监听端口。
        val port = nativeStart()
        if (port <= 0) {
            web.loadData("<h3>启动失败</h3><p>本地服务没有起来，请重开一次。</p>", "text/html; charset=utf-8", "utf-8")
            return
        }
        web.loadUrl("http://127.0.0.1:$port/#/")
    }

    /** 系统返回键先交给页面处理（hash 路由），退到根页面再退出应用。 */
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && web.canGoBack()) {
            web.goBack()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }
}
