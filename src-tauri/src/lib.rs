//! git-nest 的桌面壳（Tauri v2）。
//!
//! ## 这个壳在架构里的位置
//!
//! 界面是 `apps/web`（React + Vite），API 是 `apps/server`（Fastify + better-sqlite3，
//! 一个 **Node 进程**）。Tauri 是 Rust 的 webview 壳，它自己跑不了 Node 代码，
//! 所以「服务住在哪」必须有个答案。这里选的是 **sidecar**：Node 服务作为外部
//! 二进制（`bundle.externalBin`）随应用分发，由壳在启动时拉起。
//!
//! 另一条路是「服务留在壳外面、壳只指向 `http://127.0.0.1:36379`」——那条不用打包
//! 任何东西，但用户得自己先起一个服务，那就不算一个应用了，所以不选。
//!
//! ## 端口
//!
//! `ports::API_PORT` / `ports::WEB_PORT` 由 `build.rs` 从
//! `packages/core/src/types.ts` 的 `DEFAULT_PORTS` 生成——Rust 侧**没有**第二份
//! 数字定义（那条规则见 core 里那段注释：数字抄成两份的后果是悄悄不一致）。
//!
//! ## 为什么 Rust 里没有 `#[tauri::command]`
//!
//! 界面要的一切都走 HTTP `/api`（见 `apps/web/src/lib/api.ts`），Rust 侧不暴露
//! 自己的命令面，所以也没有对应的 capability 要声明。将来若真需要壳提供能力
//! （比如让用户用系统对话框选目录），再单独加命令 + 权限。

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// build.rs 从 `packages/core/src/types.ts` 生成的端口常量。
mod ports {
    include!(concat!(env!("OUT_DIR"), "/ports.rs"));
}

/// 拉起 Node 服务子进程。
///
/// 返回 `None` 表示「这次不拉」（dev 形态下走 vite 代理，服务由 pnpm dev 提供），
/// 让调用方能把「不拉」和「拉了但退出码非零」分开显示，而不是混成一句日志。
fn spawn_api_server(app: &tauri::AppHandle) -> Option<CommandChild> {
    // dev 形态：前端跑在 vite 上（`build.devUrl`），`/api` 由 vite 代理打到
    // 36379——那个服务由 `pnpm dev` 提供。这里再拉一个 sidecar 会和它抢端口
    // （EADDRINUSE），所以 dev 下不拉。
    //
    // release 形态：前端是打包进二进制的静态文件，没有 vite 代理，服务必须由壳自己起。
    if cfg!(debug_assertions) {
        log_line(app, "dev 形态：服务由 `pnpm dev` 提供（/api 走 vite 代理），壳不拉 sidecar");
        return None;
    }

    let Some(launcher) = launcher_path(app) else {
        log_line(
            app,
            "没找到 sidecar 启动脚本——多半是打包时漏了 bundle.resources，服务不会起来",
        );
        return None;
    };
    /*
      Node 运行时：就是 externalBin 那支 exe 本身。

      **它和脚本不在同一个目录**（这一层很容易看错）：
      - externalBin（= 一支 Node 运行时）由 Tauri 放进**可执行文件所在目录**；
      - 脚本走 resources，由 Tauri 解到**资源目录**（`git-nest-server/index.mjs`）。

      所以下面 `command` 的第一段是 `exe 自己` + `脚本路径`，等于 `node <脚本>`。
      也正因为运行时随包带，**不**依赖用户机器上装了 Node。
    */
    let runtime = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join(sidecar_exe_name())));
    let runtime = match runtime {
        Some(path) if path.exists() => path,
        Some(path) => {
            log_line(
                app,
                &format!("随包的 Node 运行时不在（{}），服务不会起来", path.display()),
            );
            return None;
        }
        None => {
            log_line(app, "拿不到可执行文件所在目录，服务不会起来");
            return None;
        }
    };

    // 数据库路径：跟着「应用数据目录」走，不跟着安装目录。
    //
    // 理由：安装目录在 Windows/macOS 上是只读的，而且卸载/升级会把它清掉——
    // 把用户唯一的那份清单（还有每个仓库的最新状态）放在那里等于随时可能丢。
    // dev（仓库里跑）沿用的是 apps/server 自己的默认值 `data/git-nest.db`，
    // 这条只覆盖 release。
    //
    // 换成「跟着仓库走」也是一种选择，但那要求用户把整个代码仓库一起分发，
    // 对一个装完就能用的软件不成立。
    let db = match app.path().app_data_dir() {
        Ok(dir) => Some(dir.join("git-nest.db")),
        Err(e) => {
            // 拿不到就用 apps/server 自己的默认值（跟着启动目录走）。
            // 比「因为拿不到目录就不起服务」好：用户至少能用，只是库的位置不理想。
            log_line(app, &format!("拿不到应用数据目录（{e}），数据库改用默认路径"));
            None
        }
    };

    let mut command = match app.shell().sidecar("git-nest-server") {
        Ok(command) => command,
        Err(e) => {
            log_line(app, &format!("sidecar 命令构造失败：{e}"));
            return None;
        }
    };
    command = command
        // 第一个参数是「入口脚本」，它和 node 一起构成这次 sidecar 的启动。
        // Tauri 把 externalBin 那支 exe 复制到目标目录、把资源解到资源目录，
        // 所以脚本路径由 resources 的解析结果给，不能写死相对路径。
        .args([launcher.to_string_lossy().to_string()])
        .env("GIT_NEST_PORT", ports::API_PORT.to_string())
        // 打包形态下页面的来源**不是** localhost:36378，所以显式告诉服务端
        // 「这次的合法来源是谁」，不依赖服务端默认值里那份清单。
        .env("GIT_NEST_CORS", webview_origin());
    if let Some(db) = db {
        command = command.env("GIT_NEST_DB", db.to_string_lossy().to_string());
    }

    match command.spawn() {
        Ok((mut events, child)) => {
            log_line(
                app,
                &format!(
                    "已拉起 sidecar（入口 {}，用随包的 {}），API 端口 {}",
                    launcher.display(),
                    runtime.display(),
                    ports::API_PORT
                ),
            );
            // 子进程的 stdout/stderr 必须有人读：管道缓冲区满了之后 Node 会阻塞在写日志上，
            // 表现出来是「服务莫名其妙卡住」。读出来并转发到壳的 stdout。
            let log_target = app.clone();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = events.recv().await {
                    match event {
                        CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                            log_line(&log_target, String::from_utf8_lossy(&bytes).trim_end())
                        }
                        CommandEvent::Terminated(payload) => log_line(
                            &log_target,
                            &format!("sidecar 退出，code={:?}", payload.code),
                        ),
                        _ => {}
                    }
                }
            });
            Some(child)
        }
        Err(e) => {
            log_line(app, &format!("拉起 sidecar 失败：{e}"));
            None
        }
    }
}

/// sidecar 的启动脚本在哪。
///
/// 它和 externalBin 那支 exe 是**两份不同的文件**：exe 是 Node 运行时（被壳 exec 的
/// 那支），脚本才是真正的服务入口，所以脚本走 `bundle.resources`。
///
/// ## 这个相对路径必须与 `tauri.conf.json` 里 `resources` 那条 glob **一模一样**
///
/// 那条 glob 是 `binaries/node-resources/git-nest-server/**/*`，而 Tauri **保留 glob 的
/// 目录结构、不剥掉任何前缀**——所以装出来是
/// `<resource_dir>/binaries/node-resources/git-nest-server/index.mjs`。
///
/// **这里曾经写错过**（第一版写成 `git-nest-server/index.mjs`，以为前缀会被剥掉）。
/// 那个错的来源是只看了 `tauri build --no-bundle` 的暂存目录
/// （`target/release/binaries/node-resources/…`，恰好和期望的形状只差一层），
/// 而「装出来长什么样」要看打包器生成的清单：
/// `src-tauri/target/release/wix/x64/main.wxs`（Windows）里有权威的目录嵌套。
/// **以后验资源落点，读那份清单，别靠推断。**（详见 `SIDECAR.md`）
fn launcher_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let path = app
        .path()
        .resolve(
            "binaries/node-resources/git-nest-server/index.mjs",
            tauri::path::BaseDirectory::Resource,
        )
        .ok()?;
    path.exists().then_some(path)
}

/// externalBin 落进可执行文件目录时用的文件名。
///
/// 与 resources **不同**：externalBin 那条路会把 `-<target-triple>` 后缀去掉
/// （实测清单里是 `<File Name="git-nest-server.exe">`，源文件是
/// `git-nest-server-x86_64-pc-windows-msvc.exe`）。两条路的命名规则不一样，
/// 是因为一条是「Tauri 认识的 sidecar」、另一条只是「随包的资源文件」。
fn sidecar_exe_name() -> &'static str {
    if cfg!(windows) {
        "git-nest-server.exe"
    } else {
        "git-nest-server"
    }
}

/// 打包形态下 webview 自己的来源（Origin）。
///
/// 为什么需要它：壳里的页面不再来自 `localhost:36378`，而是来自 Tauri 的自定义协议。
/// 服务端只认白名单里的来源（`apps/server/src/app.ts` 的 `allowedOrigins`），
/// 而跨源请求连**读**都会被 CORS 拦掉——不只是写。来源对不上的表现是
/// 「dev 下一路正常，装出来整个界面是空的」，属于最难查的那一类。
///
/// 这两个值**不是猜的，也不只住在这里**：
/// `apps/server/src/config.ts` 的 `config.tauriOrigins` 默认就包含
/// `tauri://localhost,http://tauri.localhost,https://tauri.localhost`，
/// `allowedOrigins()` 会把它并进去（`apps/server/src/app.ts:135`）——也就是说
/// 服务端**本来就认**这两个来源，本函数只是把那件事显式写出来（不依赖默认值）。
/// 注释里那几个值都是仓库里既有的判断，来源是 `config.ts:16-31`。
///
/// Tauri 2 在 Windows 上默认用 `http://` 方案（`useHttpsScheme` 为 false），
/// macOS / Linux 是 `tauri://localhost`。
///
/// **还没在真机上读出来核实过**（本轮起不了 GUI / 出不了安装包）。核实办法：
/// 打包形态跑起来后，在 webview 的 devtools 里执行 `location.origin`——
/// 若那里不是下面这个值，改这一行即可（服务端那份默认清单已经覆盖了三种写法，
/// 所以更可能是这里写得比实际宽/窄，而不是服务端不认）。
fn webview_origin() -> &'static str {
    if cfg!(windows) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    }
}

/// 建主窗口，并在**页面加载之前**把 API 基地址注入页面。
///
/// ## 为什么窗口要在 Rust 里建，而不是写在 `tauri.conf.json` 的 `app.windows`
///
/// 只有一条原因：**注入时机**。
///
/// 界面必须知道 API 的绝对地址（打包形态下没有 vite 代理，相对路径 `/api` 会打到
/// webview 自己身上）。这件事有两种做法：
///
/// 1. 写在配置的 `app.windows` 里，然后在 `setup` 里 `window.eval(...)` 补注入。
///    **不可靠**：`setup` 时页面已经开始加载，而界面一挂载就会发请求
///    （`react-query` 那几个）——注入和首屏请求在赛跑，打包后偶发「第一个请求打错地址」，
///    这种时序 bug 极难复现。
/// 2. `WebviewWindowBuilder::initialization_script`：**页面任何脚本之前**执行。
///    没有赛跑，因为它压根不并发。
///
/// 选了 2，代价是窗口的尺寸/标题这些配置从 JSON 搬到了 Rust（见下）。
/// 顺带说明为什么不用配置里的 `app.windows` + `window.__TAURI__` 那条路：
/// 全局对象是 Tauri 自己的 API，运行期地址是**我们的**事实，混在一起只会让
/// 「谁负责这个地址」变模糊。
///
/// ## 为什么地址是运行期算的
///
/// 端口来自 `build.rs` 从 `packages/core/src/types.ts` 生成的 `ports::API_PORT`
/// ——Rust 侧没有第二份数字。**不**在构建期把地址烘进前端产物（那会在用户改
/// `GIT_NEST_PORT` 时制造「服务在新端口、前端打旧端口」的组合故障，而且报错不说是端口问题）。
fn create_main_window(app: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    // dev 形态下窗口打开的是 vite（`build.devUrl`，由 build.rs 从 core 的 web 端口生成）；
    // release 形态下是打进应用的静态文件。`WebviewUrl::default()` 两种形态各自取对的那个。
    //
    // 结尾的分号不能省：初始化脚本会被拼进一段更大的脚本里，不加分号在某些拼接方式下
    // 会和后一段的首行粘成一句（ASI 不是哪里都靠得住）。
    let init_script = format!(
        "globalThis.{API_BASE_GLOBAL} = \"http://127.0.0.1:{}\";",
        ports::API_PORT
    );

    let window = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
        .title("git-nest")
        .inner_size(1280.0, 840.0)
        // 尺寸下限：三栏（导航 / 列表 / 详情）是设计基线，再窄就没有并排的意义了
        .min_inner_size(960.0, 600.0)
        .resizable(true)
        .center()
        .initialization_script(init_script)
        .build()?;

    log_line(
        app,
        &format!(
            "已建主窗口，并注入 API 基地址 http://127.0.0.1:{}",
            ports::API_PORT
        ),
    );
    Ok(window)
}

/// 壳注入 API 基地址用的全局变量名。
/// 与 `apps/web/src/lib/api.ts` 里的 `BASE_GLOBAL` 必须一致（那边有对应说明）。
const API_BASE_GLOBAL: &str = "__GIT_NEST_API_BASE__";

/// 壳的日志。
///
/// 为什么是 `eprintln!` 而不是什么日志系统：Tauri v2 **没有** `app.log(...)`
/// 这个方法（那是 `tauri-plugin-log` 插件的事，而它为这几行诊断再加一个依赖不划算）。
/// `eprintln!` 走 stderr：dev 下直接出现在终端里（最需要看的时候能看见）；
/// release 下没有控制台（`windows_subsystem = "windows"`）所以看不到，但那几条
/// 都是启动诊断——失败时用户看到的是界面上的「连不上后端」，信息并不丢。
fn log_line(_app: &tauri::AppHandle, message: &str) {
    eprintln!("[git-nest] {message}");
}

pub fn run() {
    let app = tauri::Builder::default()
        // v2 的插件式 shell：sidecar 走它（v1 的 allowlist 在 v2 已经没有了）。
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // 先建窗口（它负责把 API 地址注入页面），再拉服务。
            // 这个顺序是刻意的但**不是必须的**：页面里那些请求要等界面挂载之后才发，
            // 而注入发生在页面加载前，所以两者不会互相等。先建窗口只是让
            // 「窗口没起来」这种更早的失败更早暴露。
            let window = create_main_window(app.handle())?;
            let _ = window.set_focus();

            let child = spawn_api_server(app.handle());
            // 谁拉的谁负责收：把子进程句柄放进状态，退出时统一杀（见下面 RunEvent）。
            // 不这么做的话窗口关了 Node 还在跑，下次启动就是 EADDRINUSE。
            app.manage(ApiServer(Mutex::new(child)));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Tauri 应用初始化失败");

    app.run(|handle, event| {
        if let RunEvent::ExitRequested { .. } = event {
            if let Some(state) = handle.try_state::<ApiServer>() {
                // `kill(self)` 会夺走所有权，而 `try_state` 给的是共享引用，
                // 所以要 `take()` 出来（拿不到就是已经杀过/没起，都算正常）。
                let child = state.0.lock().ok().and_then(|mut slot| slot.take());
                if let Some(child) = child {
                    log_line(handle, "退出：正在关掉 sidecar");
                    // kill 的 Err 只可能是「已经退出了」——那正是我们想要的结果，不必报错。
                    let _ = child.kill();
                }
            }
        }
    });
}

/// 壳拉起来的那个 Node 服务进程的句柄（没拉就是 `None`）。
///
/// 包 `Mutex` 只为一个原因：`CommandChild::kill` 的签名是 `kill(self)`（夺所有权），
/// 而 Tauri 的 `State` 只能给出共享引用。用 `Mutex<Option<_>>` 把「取出并消耗」表达出来，
/// 而不是去 `clone` 一个句柄（那会把「谁负责杀」这件事变模糊）。
struct ApiServer(Mutex<Option<CommandChild>>);
