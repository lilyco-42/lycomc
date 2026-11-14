// LilyCraft Android 壳的 Gradle 入口。只做一件事：把 Rust 内核编出的
// liblycomc.so 装进 APK，用 WebView 打开本机内核起的页面。
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "LilyCraft"
include(":app")
