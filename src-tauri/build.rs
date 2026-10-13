//! Tauri v2 的构建脚本。
//!
//! 两件事：
//!
//! 1. **把端口从 `packages/core` 读出来，生成 Rust 常量**。端口只允许有一份定义
//!    （`packages/core/src/types.ts` 的 `DEFAULT_PORTS`），Rust 侧不能另写一个
//!    `36379`——这里在编译期把它抄过来。抄错或抄不到会**编译失败**，而不是等到
//!    运行期才发现壳连不上服务。
//! 2. 调 `tauri_build::build()`：v2 的代码生成 / 能力文件校验 / ACL 都由它做。
//!
//! 顺便生成一份 `gen/app.config.json` 给 CLI 用（`tauri dev --config`）：`devUrl`
//! 里那个端口同样只该有 core 一份定义，所以它也是从这里生成的，而不是在
//! `tauri.conf.json` 里再抄一遍（那个文件里的 `build.devUrl` 因此刻意留空）。
//!
//! 为什么不放在 `tauri.conf.json` 里而是生成：Tauri 的配置是静态 JSON，
//! 没有插值能力；把数字写在两处正是 core 那份注释里点名要消灭的「悄悄不一致」
//! （web 端口和 devUrl 不一致时，窗口打开的是**别的**服务，或者干脆白屏）。

use std::fs;
use std::path::Path;

fn main() {
    let core_types = Path::new("../packages/core/src/types.ts");

    // core 读写都要触发重编译：改端口必须让 Rust 侧跟着重建
    println!("cargo:rerun-if-changed={}", core_types.display());
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=build.rs");

    let source = fs::read_to_string(core_types).unwrap_or_else(|e| {
        panic!(
            "读不到 {}（{e}）。这个文件是端口常量的唯一来源，构建脚本必须能读到它。",
            core_types.display()
        )
    });

    let ports = parse_default_ports(&source);
    let out_dir = std::env::var("OUT_DIR").expect("cargo 一定会给 OUT_DIR");
    fs::write(
        Path::new(&out_dir).join("ports.rs"),
        format!(
            "// 由 build.rs 从 packages/core/src/types.ts 生成，不要手改。\n\
             // WEB_PORT 目前只有 build.rs 生成 devUrl 时用得上，Rust 侧没有读者——\n\
             // 仍然生成它，是为了让「端口只有 core 一处定义」这件事在生成物里也是完整的：\n\
             // 哪天壳要开一个指向界面的窗口（比如「在浏览器里打开」），不用回去补。\n\
             #[allow(dead_code)]\n\
             pub const WEB_PORT: u16 = {};\n\
             pub const API_PORT: u16 = {};\n",
            ports.web, ports.api
        ),
    )
    .expect("写 ports.rs 失败");

    // 给 Tauri CLI 的覆盖配置（gitignore 掉的生成物）。CLI 用 `--config` 加载它，
    // 与 tauri.conf.json 合并后使用，所以这里只需要放「由 core 派生的字段」。
    let gen_dir = Path::new("gen");
    fs::create_dir_all(gen_dir).expect("建 src-tauri/gen 失败");
    write_if_changed(
        &gen_dir.join("app.config.json"),
        &format!(
            "{{\n  \"build\": {{\n    \"devUrl\": \"http://localhost:{}\"\n  }}\n}}\n",
            ports.web
        ),
    );

    tauri_build::build()
}

struct Ports {
    web: u16,
    api: u16,
}

/// 从 core 的 `DEFAULT_PORTS = { web: NNNNN, api: NNNNN }` 里取两个数字。
///
/// 刻意用最笨的字符串扫描而不是引 TS 运行时：构建脚本不该为了读两个整数
/// 去依赖 node/pnpm 在不在 PATH 上（`cargo check` 要能独立跑通）。
fn parse_default_ports(source: &str) -> Ports {
    let anchor = source.find("DEFAULT_PORTS").unwrap_or_else(|| {
        panic!("core 的 types.ts 里找不到 DEFAULT_PORTS——端口常量的位置变了？")
    });
    let tail = &source[anchor..];
    let end = tail.find('}').expect("DEFAULT_PORTS 后面应该有 `}`");
    let body = &tail[..end];

    let read = |key: &str| -> u16 {
        let at = body
            .find(key)
            .unwrap_or_else(|| panic!("DEFAULT_PORTS 里找不到 `{key}`"))
            + key.len();
        let rest = &body[at..];
        let colon = rest.find(':').expect("键后面应该有 `:`");
        let digits: String = rest[colon + 1..]
            .chars()
            .skip_while(|c| !c.is_ascii_digit())
            .take_while(char::is_ascii_digit)
            .collect();
        digits
            .parse()
            .unwrap_or_else(|_| panic!("DEFAULT_PORTS.{key} 不是数字：`{digits}`"))
    };

    Ports {
        web: read("web"),
        api: read("api"),
    }
}

/// 只在内容变了的时候写文件。
///
/// 不是优化：`gen/app.config.json` 的修改时间一变，Tauri 的 dev watcher 会以为
/// 配置变了而重启整个应用——每次 `cargo check` 都触发一遍很烦人。
fn write_if_changed(path: &Path, contents: &str) {
    if fs::read_to_string(path).ok().as_deref() == Some(contents) {
        return;
    }
    fs::write(path, contents).expect("写生成配置失败");
}
