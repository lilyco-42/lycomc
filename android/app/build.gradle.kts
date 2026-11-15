// LilyCraft 安卓壳：Kotlin + WebView，业务逻辑全在 Rust 内核里。
//
// 构建前置（CI 里由 .github/workflows/release.yml 完成）：
//   cargo ndk -t arm64-v8a -t x86_64 -o android/app/src/main/jniLibs build --release --lib
// 产物：app/src/main/jniLibs/<abi>/liblycomc.so
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.lilycraft.launcher"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.lilycraft.launcher"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.1"
        ndk {
            // 只保留手机主流的 arm64 与模拟器/桌面 x86_64，减小包体。
            abiFilters += listOf("arm64-v8a", "x86_64")
        }
    }

    buildTypes {
        release {
            // 未配置签名时只产出 unsigned APK，不假装已签名发布。
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    // 直接引用 cargo-ndk 输出的 .so，不额外写拷贝任务。
    sourceSets["main"].jniLibs.srcDirs("src/main/jniLibs")
}

dependencies {
    implementation("androidx.webkit:webkit:1.11.0")
}

// 构建前检查内核产物是否就位，避免打出「能装但一启动就 UnsatisfiedLinkError」的包。
val checkRustLib by tasks.registering {
    doFirst {
        val dir = file("src/main/jniLibs")
        val found = dir.walkTopDown().any { it.name == "liblycomc.so" }
        if (!found) {
            throw GradleException(
                "缺少 liblycomc.so：先执行 " +
                    "cargo ndk -t arm64-v8a -t x86_64 -o android/app/src/main/jniLibs build --release --lib",
            )
        }
    }
}

tasks.named("preBuild") { dependsOn(checkRustLib) }
