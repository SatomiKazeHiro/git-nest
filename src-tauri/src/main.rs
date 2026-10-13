// Windows 上的 release 构建不弹一个附带的控制台窗口。
// 这是 Tauri v2 模板的默认形态；dev 构建也受益（不然调试时多一个黑窗）。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// bin 只有一行：真正的逻辑在 lib 里（`src/lib.rs` 的 `run()`）。
//
// 为什么拆开：Tauri v2 的模板把 `run()` 放在 lib 里，是为了将来要加移动端目标时
// （iOS/Android 的入口由各平台的工程文件调同一个 lib），入口不用重写一遍。
// 桌面这里两者等价，但保持与 v2 生态一致的形状，省得以后多一次搬运。
fn main() {
    git_nest_lib::run()
}
