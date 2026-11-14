# 壳里只有 JNI 入口需要保留名字，其余无自定义规则。
-keepclasseswithmembernames class app.lilycraft.launcher.MainActivity {
    native <methods>;
}
