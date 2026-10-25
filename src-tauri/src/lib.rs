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

// ============================================================================
// 数据根：应用自己的数据（数据库 + WebView2 的用户数据）放哪
// ============================================================================

/// 显式覆盖数据根的环境变量。
const DATA_DIR_ENV: &str = "GIT_NEST_DATA_DIR";

/// 数据根里的子目录名（数据根本身是 exe 旁边的 `git-nest-data/` 或系统的本地数据目录）。
const DATA_DIR_NAME: &str = "git-nest-data";

/// WebView2 读的环境变量名。设它 = 把 WebView2 的用户数据目录从
/// `%LOCALAPPDATA%\<identifier>\EBWebView` 挪到我们指定的地方。
const WEBVIEW2_DATA_ENV: &str = "WEBVIEW2_USER_DATA_FOLDER";

/// **纯决策**：数据根选哪个。不碰文件系统、不读环境变量——所以能被穷举测试。
///
/// ## 规则（用户定的，只有一个来源 + 一个显式覆盖）
///
/// **数据永远在 exe 旁边**：`<exe 所在目录>\git-nest-data\`。
/// 便携版 = 把整个目录拷走，数据跟着走；安装版 = 装在哪个目录，数据就在哪个目录。
/// 这是用户的明确要求：「未来软件是安装到某目录或者使用便携版在某个目录下，
/// 那么产生的数据就应该和这个 .exe 是一样的（同一）目录中的」。
///
/// `GIT_NEST_DATA_DIR` 是**显式覆盖**（「我知道自己在做什么」的逃生口），
/// 优先级最高。
///
/// ## 这里刻意**没有**「退回系统数据目录」那一档
///
/// 早先的版本是「exe 目录不可写 → 悄悄退到 `%LOCALAPPDATA%`」。**那个行为是错的**：
/// 它正是用户要消除的东西——数据跑到用户没指定的地方去（这台机器上还直接导致了
/// 另一件事：C 盘那个位置 WebView2 建不起 environment，窗口根本起不来）。
///
/// 所以现在：**写不进去就是失败**，并且失败必须**大声且可操作**——
/// 说清想写哪儿、为什么写不了、怎么办（换安装目录 / 设 `GIT_NEST_DATA_DIR`）。
/// 绝不悄悄换个地方写。
fn choose_data_root(
    explicit: Option<PathBuf>,
    exe_dir: Option<&std::path::Path>,
    probe: impl FnOnce(&std::path::Path) -> Result<(), String>,
) -> Result<PathBuf, String> {
    let (root, decided_by) = match explicit {
        Some(dir) => (dir, DATA_DIR_ENV),
        None => {
            let dir = exe_dir.ok_or_else(|| {
                "拿不到 exe 所在目录，没法确定数据该放哪。\
                 可以设 GIT_NEST_DATA_DIR 显式指定一个位置。"
                    .to_string()
            })?;
            (dir.join(DATA_DIR_NAME), "exe 所在目录")
        }
    };

    probe(&root).map_err(|reason| {
        format!(
            "数据要写到 {}（由 {decided_by} 决定），但那里写不进去：{reason}。\
             怎么办（任选其一）：① 换一个可写的安装目录（NSIS 安装包默认装到\
             %LOCALAPPDATA%\\Programs 下，那里可写；MSI 装到 Program Files，那里对普通用户只读）；\
             ② 设环境变量 {DATA_DIR_ENV} 指到一个可写的位置；\
             ③ 用便携版，把整个目录放到可写的地方。",
            root.display()
        )
    })?;

    Ok(root)
}

/// 探测一个目录**真的**能当数据根用：建出来 + 写一个文件再删掉。
///
/// 为什么要写一个真文件而不是只看权限位或 `create_dir_all` 是否成功：
/// - 目录**已经存在但只读**时 `create_dir_all` 会成功返回（它什么都不用做）；
/// - Windows 上「属性里看着可写、实际 ACL 拒绝」很常见（Program Files 就是）。
///
/// 所以判据必须是**真的写进去一次**。
fn probe_writable_dir(dir: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("建目录失败：{e}"))?;
    let marker = dir.join(".git-nest-writable");
    std::fs::write(&marker, b"probe").map_err(|e| format!("写入探测文件失败：{e}"))?;
    // 删不掉不影响「能写」这个结论（比如被杀软锁住），所以这里不把失败当错误
    let _ = std::fs::remove_file(&marker);
    Ok(())
}

// ============================================================================
// 交给 Node 的路径：必须剥掉 Windows 的扩展长度前缀
// ============================================================================

/// 把 Windows 的 verbatim（扩展长度）前缀剥掉，得到一个普通路径字符串。
///
/// ## 为什么必须有这个函数（实测踩过）
///
/// `resource_dir()` 在 Windows 上可能给出 `\\?\D:\...` 这种 verbatim 形式
/// （`\\?\` 前缀让 Win32 API 绕过 MAX_PATH 与路径规范化）。Rust 自己处理它没问题，
/// **但 Node 不行**：把它当「主模块」解析时（`node:internal/modules/run_main` 的
/// `resolveMainPath` → `fs.realpathSync`）会把它拆成 `D:`，于是：
///
/// ```text
/// Error: EISDIR: illegal operation on a directory, lstat 'D:'
///     at Object.realpathSync (node:fs:2749:25)
/// sidecar 退出，code=Some(1)
/// ```
///
/// 后果是**装出来的应用界面永远显示「后端没启动」**，而 `git-nest.db` 从未被创建
/// ——因为服务进程一启动就死了。
///
/// ## 为什么冒烟没抓到
///
/// 隔离冒烟用的是**普通路径**（`%TEMP%` 下自己拼的），而真实安装形态下
/// `resource_dir()` 给的是 verbatim 形式——**两者恰好差在最要命的那一处**。
/// 教训：冒烟必须复刻**安装后的布局与路径来源**，不能只复刻文件内容。
///
/// 映射规则（两处都要认，UNC 那个不能漏）：
/// - `\\?\D:\x` → `D:\x`
/// - `\\?\UNC\server\share\x` → `\\server\share\x`
/// - 没有前缀 → 原样返回
///
/// 前缀判定**大小写不敏感**：Windows 路径不区分大小写，`\\?\` 也可能被写成 `\\?\`
/// 之外的形态（比如 `//?/`），所以统一先把 `/` 也当分隔符看待。
fn strip_verbatim_prefix(path: &str) -> String {
    // 同时认 `/` 与 `\`：Windows 上两者都能当分隔符
    let normalized_seps = path.replace('/', "\\");
    let lower = normalized_seps.to_ascii_lowercase();

    const VERBATIM: &str = "\\\\?\\";
    if !lower.starts_with(VERBATIM) {
        // 没有前缀就原样返回**原字符串**（不做分隔符替换：非 Windows 上
        // `/` 是合法分隔符，替换会改坏它）
        return path.to_string();
    }

    let rest = &normalized_seps[VERBATIM.len()..];
    // UNC：`\\?\UNC\server\share` 去掉 `UNC\` 再补回两个反斜杠
    const UNC: &str = "UNC\\";
    if rest.len() >= UNC.len() && rest[..UNC.len()].eq_ignore_ascii_case(UNC) {
        return format!("\\\\{}", &rest[UNC.len()..]);
    }
    rest.to_string()
}

/// 交给子进程（Node）用的路径字符串：剥掉 verbatim 前缀。
///
/// 所有要跨进程边界的路径都必须走它——**入口脚本**（那次事故就是它）、
/// `GIT_NEST_DB`、子进程的工作目录。日志里那次 `GIT_NEST_DB` 恰好是干净的，
/// 但那是运气，不是保证：同一个 `resource_dir()`/`app_data_dir()` 出来的东西
/// 随时可能带上前缀。**一处收口，别到处各剥一次。**
fn path_for_child(path: &std::path::Path) -> String {
    strip_verbatim_prefix(&path.to_string_lossy())
}

/// **读写环境**：把 `choose_data_root` 需要的现实值取出来。
///
/// 失败时把原因**返回**给调用方（由它决定怎么大声说出来）；成功时也交给调用方
/// 去记日志——因为日志系统本身要等数据根定下来才能配置（日志文件就写在数据根里）。
fn data_root() -> Result<PathBuf, String> {
    let explicit = std::env::var_os(DATA_DIR_ENV)
        .map(PathBuf::from)
        // 覆盖值也可能是 verbatim 形式（用户从别处复制来的路径），同样规范化：
        // 这个路径会一路传到 Node 的 GIT_NEST_DB
        .map(|p| PathBuf::from(strip_verbatim_prefix(&p.to_string_lossy())));
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(std::path::Path::to_path_buf));

    choose_data_root(explicit, exe_dir.as_deref(), probe_writable_dir)
}

/// WebView2 的用户数据目录。**必须在建窗之前**把它设为进程环境变量。
///
/// ## 为什么这件事是必须的（实测，不是预防性措施）
///
/// 这台机器上 WebView2 的默认用户数据目录在 `%LOCALAPPDATA%`（C 盘），
/// 而那里的 environment **建不起来**：窗口创建直接失败并 panic
/// （`failed to create webview: WindowsError(0x8000FFFF, "灾难性故障")`，
/// 也就是 `E_UNEXPECTED`）。把 `WEBVIEW2_USER_DATA_FOLDER` 指到 D 盘就正常。
///
/// 顺带一提：`%TEMP%` 也不行——它也在 C 盘。所以这不是「换了个目录」，
/// 而是「换了**卷**」，这也是为什么探测必须落在真实路径上。
///
/// ## 为什么要用进程级环境变量
///
/// WebView2 读这个变量是在**创建 environment 的那一刻**（= 建窗那一刻），
/// 而它没有别的传参入口。所以：设一次、且在 `create_main_window()` **之前**设。
/// 这里没有别的取巧方式（不是 Tauri 的 API，是 WebView2 自己的约定）。
///
/// 失败**不是致命的**：设不上就退回 WebView2 的默认位置——在能用的机器上一切照旧，
/// 在这台机器上会复现那个 panic。所以失败要留一行日志，别让人以为是别的原因。
fn prepare_webview2_data_dir(root: &std::path::Path) {
    let dir = root.join("EBWebView");
    if let Err(e) = std::fs::create_dir_all(&dir) {
        log_line(&format!(
            "建 WebView2 数据目录失败（{}）：{e}",
            dir.display()
        ));
        return;
    }
    // 这是进程级的环境变量。Rust 2021 里 set_var 是安全函数；
    // 它唯一的风险是「别的线程正在读环境变量」——而我们此刻还在 setup 的最前面，
    // 还没有任何自建的线程（WebView2 与 sidecar 都还没起）。
    std::env::set_var(WEBVIEW2_DATA_ENV, &dir);
    log_line(&format!("{WEBVIEW2_DATA_ENV} = {}", dir.display()));
}

/// 拉起 Node 服务子进程。
///
/// 返回 `None` 表示「这次不拉」（dev 形态下走 vite 代理，服务由 pnpm dev 提供），
/// 让调用方能把「不拉」和「拉了但退出码非零」分开显示，而不是混成一句日志。
///
/// `data_root` 是数据根（exe 旁边的 `git-nest-data\`，或 `GIT_NEST_DATA_DIR`）。
/// 数据库就落在它里面。
fn spawn_api_server(
    app: &tauri::AppHandle,
    data_root: &std::path::Path,
) -> Option<CommandChild> {
    // dev 形态：前端跑在 vite 上（`build.devUrl`），`/api` 由 vite 代理打到
    // 36379——那个服务由 `pnpm dev` 提供。这里再拉一个 sidecar 会和它抢端口
    // （EADDRINUSE），所以 dev 下不拉。
    //
    // release 形态：前端是打包进二进制的静态文件，没有 vite 代理，服务必须由壳自己起。
    if cfg!(debug_assertions) {
        log_line("dev 形态：服务由 `pnpm dev` 提供（/api 走 vite 代理），壳不拉 sidecar");
        return None;
    }

    let Some(launcher) = launcher_path(app) else {
        log_line("没找到 sidecar 启动脚本——多半是打包时漏了 bundle.resources，服务不会起来");
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
            log_line(&format!(
                "随包的 Node 运行时不在（{}），服务不会起来",
                path.display()
            ));
            return None;
        }
        None => {
            log_line("拿不到可执行文件所在目录，服务不会起来");
            return None;
        }
    };

    // 数据库落在**数据根**里（`<exe 目录>/git-nest-data/git-nest.db`，或 GIT_NEST_DATA_DIR 指定的位置）。
    //
    // 数据根已经在 setup 里探测过可写（不可写就直接中止启动了），所以这里**没有**
    // 「拿不到就换别处」的分支——那正是用户要消除的行为（数据跑到没指定的地方）。
    //
    // dev 形态（`cfg!(debug_assertions)`）在上面就早返回了、根本不拉 sidecar，
    // 所以这里只影响打包形态；dev 下数据库仍走 apps/server 自己的默认值
    // （仓库里的 `data/git-nest.db`），这一点**刻意不改**：现有开发流程与测试
    // 都依赖那个位置。
    let db = data_root.join("git-nest.db");

    let mut command = match app.shell().sidecar("git-nest-server") {
        Ok(command) => command,
        Err(e) => {
            log_line(&format!("sidecar 命令构造失败：{e}"));
            return None;
        }
    };
    command = command
        // 第一个参数是「入口脚本」，它和 node 一起构成这次 sidecar 的启动。
        // Tauri 把 externalBin 那支 exe 复制到目标目录、把资源解到资源目录，
        // 所以脚本路径由 resources 的解析结果给，不能写死相对路径。
        //
        // **必须走 `path_for_child()`**：这条路径在 Windows 上可能是 verbatim
        // （`\\?\D:\…`）形式，而 Node 解析不了它 —— 实测报
        // `EISDIR: illegal operation on a directory, lstat 'D:'` 并立刻退出，
        // 界面表现为「后端没启动」。详细来龙去脉见 `strip_verbatim_prefix` 的注释。
        .args([path_for_child(&launcher)])
        .env("GIT_NEST_PORT", ports::API_PORT.to_string())
        // 打包形态下页面的来源**不是** localhost:36378，所以显式告诉服务端
        // 「这次的合法来源是谁」，不依赖服务端默认值里那份清单。
        .env("GIT_NEST_CORS", webview_origin())
        // 同理：凡是跨进程的路径都规范化，别指望「恰好是干净的」
        .env("GIT_NEST_DB", path_for_child(&db));

    let label = format!(
        "入口 {}，随包的运行时 {}，数据库 {}",
        path_for_child(&launcher),
        runtime.display(),
        db.display()
    );
    spawn_sidecar(command, &label)
}

/// 真正 spawn，并把子进程的 stdout/stderr 排空后**转发进壳自己的日志**。
///
/// 为什么单独一个函数：排空管道这段逻辑**不能省**——管道缓冲区满了之后 Node 会
/// 阻塞在写日志上，表现出来是「服务莫名其妙卡住」。而且它必须把内容转发到
/// `log_line`（于是落进 `<数据根>\logs\git-nest.log`）：真实的 `EISDIR` 事故里，
/// 那两行报错是 **Node** 打出来的，只有靠这条转发才能在双击启动、没有控制台的情况下留痕。
fn spawn_sidecar(
    command: tauri_plugin_shell::process::Command,
    label: &str,
) -> Option<CommandChild> {
    match command.spawn() {
        Ok((mut events, child)) => {
            log_line(&format!(
                "已拉起 sidecar（{label}），API 端口 {}",
                ports::API_PORT
            ));
            // 子进程的 stdout/stderr 必须有人读：管道缓冲区满了之后 Node 会阻塞在写日志上，
            // 表现出来是「服务莫名其妙卡住」。读出来并写进壳自己的日志
            // （于是 sidecar 的报错也会落进 `<数据根>\logs\git-nest.log`——
            //  真实的 EISDIR 事故里，`Error: EISDIR…` 那两行是 Node 打出来的，
            //  正是靠这条转发才留得下来）。
            tauri::async_runtime::spawn(async move {
                while let Some(event) = events.recv().await {
                    match event {
                        CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                            log_line(String::from_utf8_lossy(&bytes).trim_end())
                        }
                        CommandEvent::Terminated(payload) => {
                            log_line(&format!("sidecar 退出，code={:?}", payload.code))
                        }
                        _ => {}
                    }
                }
            });
            Some(child)
        }
        Err(e) => {
            log_line(&format!("拉起 sidecar 失败：{e}"));
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
        /*
          **不要系统标题栏**。界面自己已经有标题栏（`components/TitleBar.tsx`）：
          品牌 + 拖拽区 + 最小化 / 最大化 / 关闭。两套标题栏叠在一起时，上面那条
          是系统的、下面那条是应用的，两排按钮做同一件事——桌面软件里没有比这更
          像"壳没做完"的东西。

          ## 三件必须一起成立的事

          1. **拖窗口**：靠 ``TitleBar`` 上的 `data-tauri-drag-region`（Tauri 靠这个
             属性识别可拖区域），所以系统标题栏去掉之后照样能拖。
          2. **窗口控件真的画得出来**：`lib/platform.ts` 从
             `__TAURI__.window.getCurrentWindow()` 拿实例，能力由
             `capabilities/main-window.json` 里的 `core:window:allow-*` 给。
             **这一条是硬前提**：没有标题栏之后，如果控件也没画出来，窗口就没有
             关闭按钮了（只剩 Alt+F4 / 任务栏右键）。
          3. **能改大小**：系统边框去掉不影响边缘拖动改大小——窗口仍带
             `resizable` 与可点击的边（Windows 上由窗口系统处理）。
             实在要调大小也还有 `min_inner_size` 挡着，不会缩成一条缝。

          `shadow(true)`：无边框窗口在 Windows 上默认没有系统投影，桌面上会显得
          "贴"在壁纸上、边界糊成一片；这一条把它拉回一个窗口该有的立体感。
        */
        .decorations(false)
        .shadow(true)
        .center()
        .initialization_script(init_script)
        .build()?;

    log_line(&format!(
        "已建主窗口，并注入 API 基地址 http://127.0.0.1:{}",
        ports::API_PORT
    ));
    Ok(window)
}

/// 壳注入 API 基地址用的全局变量名。
/// 与 `apps/web/src/lib/api.ts` 里的 `BASE_GLOBAL` 必须一致（那边有对应说明）。
const API_BASE_GLOBAL: &str = "__GIT_NEST_API_BASE__";

/// 壳的日志。
///
/// 走 `log` crate → `tauri-plugin-log`（见 `run()` 里的注册）：
/// **stderr** 一份（dev / 终端里直接看得到）+ **数据根下 `logs/git-nest.log`** 一份。
///
/// 为什么文件那一份是必须的：用户在资源管理器里双击启动时**没有控制台**，
/// 而 `log_line` 之前是 `eprintln!`（没有插件）——于是「已拉起 sidecar /
/// 没找到启动脚本 / sidecar 退出 code=1」这些关键线索全部丢掉。
/// 真实的 `EISDIR` 事故就是这么被藏了一整轮的：装了 MSI、界面报「后端没启动」，
/// 而唯一能说明原因的那几行只存在于「从终端跑」的那次。
fn log_line(message: &str) {
    log::info!("{message}");
}

/// 日志文件的目录名（在数据根下）。**跟着数据走**：便携版整个目录拷走，日志也一起走。
const LOG_DIR_NAME: &str = "logs";
/// 日志文件名（不含扩展名；插件自己补 `.log`）。
const LOG_FILE_NAME: &str = "git-nest";

pub fn run() {
    // ---- 第一步（在建 app、建窗之前）：定数据根，并把 WebView2 与日志都指过去 ----
    //
    // 为什么这么早：
    // - `WEBVIEW2_USER_DATA_FOLDER` 必须在**创建 webview**（建窗那一刻）之前设好；
    // - 日志文件要写在数据根里，所以日志插件的 `targets` 也得等数据根定下来才能配；
    // - 两者都必须在 `tauri::Builder` 之前算出来，因为插件是构建期注册的。
    //
    // 这一步失败就**大声中止**（不退回别处——数据跑到用户没指定的地方正是要消除的行为）。
    // 此时日志系统还没起来，所以这里只能走 stderr；而 Windows release 没有控制台，
    // 于是**同时**用一个最小文件落盘兜底（见 `panic_on_no_data_root`）。
    let root = match data_root() {
        Ok(root) => root,
        Err(reason) => panic_on_no_data_root(&reason),
    };

    let app = tauri::Builder::default()
        // 日志：stderr（dev / 终端里直接看得到）+ 数据根下的文件。
        // **文件那一份是必须的**：用户在资源管理器里双击启动时没有控制台，
        // 没有它「已拉起 sidecar / sidecar 退出 code=1」这类关键线索会全部丢掉
        // （真实的 EISDIR 事故就是这么被藏了一整轮的）。
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                // 默认上限只有 40KB：sidecar 的 stdout/stderr 全量转发进来，一次
                // fetch 大仓库就能把它冲掉，真出事故时反而看不到前面的线索。
                // 1MB 对纯文本诊断够深，又不会无限长（默认 KeepOne，只留当前这份）。
                .max_file_size(1_000_000)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stderr),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
                        path: root.join(LOG_DIR_NAME),
                        file_name: Some(LOG_FILE_NAME.to_string()),
                    }),
                ])
                .build(),
        )
        // v2 的插件式 shell：sidecar 走它（v1 的 allowlist 在 v2 已经没有了）。
        .plugin(tauri_plugin_shell::init())
        // 系统目录选择框（添加项目时的「选择目录…」）。
        // **不注册这一行，前端那枚按钮就不会画**：`__TAURI__.dialog` 不存在，
        // `apps/web/src/lib/platform.ts` 会如实报告「这项能力没有」
        // ——不画按钮比画一个点了没反应的按钮好，但用户也就少了那个便利。
        .plugin(tauri_plugin_dialog::init())
        .setup({
            let root = root.clone();
            move |app| {
                let handle = app.handle();
                log::info!("数据根：{}", path_for_child(&root));

                // WebView2 的用户数据目录指到数据根下（必须在建窗之前）。
                prepare_webview2_data_dir(&root);

                // 第二步：建窗口（它负责把 API 基地址注入页面）。
                let window = create_main_window(handle)?;
                let _ = window.set_focus();

                // 第三步：拉服务（release 形态）。数据库落在数据根里。
                let child = spawn_api_server(handle, &root);
                // 谁拉的谁负责收：把子进程句柄放进状态，退出时统一杀（见下面 RunEvent）。
                // 不这么做的话窗口关了 Node 还在跑，下次启动就是 EADDRINUSE。
                app.manage(ApiServer(Mutex::new(child)));
                Ok(())
            }
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
                    log::info!("退出：正在关掉 sidecar");
                    // kill 的 Err 只可能是「已经退出了」——那正是我们想要的结果，不必报错。
                    let _ = child.kill();
                }
            }
        }
    });
}

/// 数据根定不下来时的**大声失败**：stderr + 尽力写一份文件，然后 panic。
///
/// 为什么要写文件：这一刻日志插件还没注册（它本身就依赖数据根），而 Windows 的
/// release 构建没有控制台——只 `eprintln!` 的话，双击启动的用户**什么也看不到**，
/// 只会觉得「点了没反应」。所以再尽力往 exe 旁边、以及 `%TEMP%` 各写一份。
/// 写不成就放弃（已经 `eprintln!` 过了），绝不因为「记录失败」而换个错误死法。
fn panic_on_no_data_root(reason: &str) -> ! {
    let message = format!(
        "无法确定数据目录（数据要放在 exe 旁边的 git-nest-data\\ 里），启动中止。\n{reason}\n"
    );
    eprintln!("[git-nest] {message}");

    // 尽力落盘：exe 旁边（可能正是写不了的那个地方，所以再试 TEMP）
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("git-nest-startup-error.log"));
        }
    }
    candidates.push(std::env::temp_dir().join("git-nest-startup-error.log"));
    for path in candidates {
        if std::fs::write(&path, &message).is_ok() {
            eprintln!("[git-nest] 这条错误也写到了：{}", path.display());
        }
    }

    // 弹一个系统对话框：release 没有控制台，不弹的话双击启动的用户只会看到
    // 「点了没反应」。此刻 webview 还没建出来，tauri 自己的 dialog 插件指望不上，
    // 所以走 rfd（纯系统对话框，不依赖事件循环）。弹不出来也无所谓——
    // stderr 和落盘文件已经在了，不因为「通知失败」换个死法。
    let _ = rfd::MessageDialog::new()
        .set_title("git-nest 无法启动")
        .set_description(&message)
        .set_level(rfd::MessageLevel::Error)
        .show();

    panic!("{message}");
}

/// 壳拉起来的那个 Node 服务进程的句柄（没拉就是 `None`）。
///
/// 包 `Mutex` 只为一个原因：`CommandChild::kill` 的签名是 `kill(self)`（夺所有权），
/// 而 Tauri 的 `State` 只能给出共享引用。用 `Mutex<Option<_>>` 把「取出并消耗」表达出来，
/// 而不是去 `clone` 一个句柄（那会把「谁负责杀」这件事变模糊）。
struct ApiServer(Mutex<Option<CommandChild>>);

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn decide(
        explicit: Option<&str>,
        exe_dir: Option<&str>,
        writable: bool,
    ) -> Result<PathBuf, String> {
        choose_data_root(
            explicit.map(PathBuf::from),
            exe_dir.map(Path::new),
            |_| {
                if writable {
                    Ok(())
                } else {
                    Err("拒绝访问 (os error 5)".to_string())
                }
            },
        )
    }

    #[test]
    fn 默认数据根就是_exe_旁边的_git_nest_data() {
        let root = decide(None, Some("/exe/dir"), true).unwrap();
        assert_eq!(root, PathBuf::from("/exe/dir/git-nest-data"));
    }

    #[test]
    fn 显式覆盖优先于_exe_目录() {
        // 即使 exe 目录可写，也听 GIT_NEST_DATA_DIR 的——「有就用，别猜」
        let root = decide(Some("/custom/data"), Some("/exe/dir"), true).unwrap();
        assert_eq!(root, PathBuf::from("/custom/data"));
    }

    #[test]
    fn exe_目录不可写时大声失败_不退回别处() {
        // 这一条钉的是**规则本身**：装到 Program Files（只读）时**不许**悄悄换地方写。
        // 原来那条「退回 %LOCALAPPDATA%」正是用户要消除的行为。
        let err = decide(None, Some("/exe/dir"), false).unwrap_err();
        // 用 Path::join 拼期望值，别写字面量：Windows 上是反斜杠，
        // 第一版写 "/exe/dir/git-nest-data" 就在这里红了
        let expected = Path::new("/exe/dir").join(DATA_DIR_NAME);
        assert!(
            err.contains(&expected.display().to_string()),
            "要说清想写哪儿（{}）：{err}",
            expected.display()
        );
        assert!(err.contains("os error 5"), "要带上底层原因：{err}");
        // 三条出路都要给出来，否则用户拿到报错也不知道怎么办
        assert!(err.contains(DATA_DIR_ENV), "要给出覆盖变量：{err}");
        assert!(err.contains("安装目录"), "要给出换安装目录这条路：{err}");
        assert!(err.contains("便携"), "要给出便携版这条路：{err}");
    }

    #[test]
    fn 显式覆盖不可写时也不能退回() {
        let err = decide(Some("/custom/data"), Some("/exe/dir"), false).unwrap_err();
        assert!(err.contains("/custom/data"), "{err}");
        // 明确点出是**谁**指定的，免得用户以为是自动选的
        assert!(err.contains(DATA_DIR_ENV), "{err}");
    }

    #[test]
    fn 拿不到_exe_目录时报错并给出逃生口() {
        let err = decide(None, None, true).unwrap_err();
        assert!(err.contains(DATA_DIR_ENV), "要给出覆盖变量：{err}");
    }

    #[test]
    fn 剥掉_verbatim_前缀_这是真实事故那一串() {
        // 事故里的原样路径（`resource_dir()` 给出来的形式）：
        // 交给 Node 之后它把主模块解析成了 `D:` → EISDIR → sidecar 立刻退出。
        assert_eq!(
            strip_verbatim_prefix(r"\\?\D:\ToolSoftware\git-nest\binaries\node-resources\git-nest-server\index.mjs"),
            r"D:\ToolSoftware\git-nest\binaries\node-resources\git-nest-server\index.mjs"
        );
    }

    #[test]
    fn 剥掉_verbatim_前缀_UNC_形式() {
        // UNC 那个分支不能漏：`\\?\UNC\server\share` 要还原成 `\\server\share`
        assert_eq!(
            strip_verbatim_prefix(r"\\?\UNC\server\share\index.mjs"),
            r"\\server\share\index.mjs"
        );
    }

    #[test]
    fn 没有前缀就原样不动() {
        assert_eq!(
            strip_verbatim_prefix(r"D:\plain\path\index.mjs"),
            r"D:\plain\path\index.mjs"
        );
        // 正斜杠在没有前缀时**不能被改写**（非 Windows 上 `/` 是合法分隔符）
        assert_eq!(
            strip_verbatim_prefix("/home/me/git-nest/index.mjs"),
            "/home/me/git-nest/index.mjs"
        );
    }

    #[test]
    fn 前缀判定大小写不敏感() {
        // Windows 路径不区分大小写，`UNC` 段也一样
        assert_eq!(strip_verbatim_prefix(r"\\?\unc\server\share\x"), r"\\server\share\x");
        // 前缀本身的字符大小写（`\\?\` 没有字母，但反斜杠/正斜杠混写要认）
        assert_eq!(strip_verbatim_prefix(r"//?/D:/x/y"), r"D:\x\y");
    }

    #[test]
    fn 交给子进程的路径统一走规范化() {
        // `path_for_child` 是唯一的出口：入口脚本、GIT_NEST_DB、工作目录都用它
        assert_eq!(
            path_for_child(Path::new(r"\\?\D:\a\b.mjs")),
            r"D:\a\b.mjs"
        );
        assert_eq!(path_for_child(Path::new(r"D:\a\b.mjs")), r"D:\a\b.mjs");
    }

    #[test]
    fn probe_真的会去写文件_而不是只看目录存不存在() {        // **刻意不用 `std::env::temp_dir()`**：那在本机（以及这台机器的沙箱里）是 C 盘，
        // 而写 C 盘会直接 `拒绝访问 (os error 5)`——正好和这个功能要解决的根因同类。
        // 用 crate 目录（D 盘）下的 target/：cargo 刚在那里建过东西，一定可写，且已被 gitignore。
        let base = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("probe-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        // 目录不存在 → 它能建出来并写进去。
        // 断言里带上真实错误：只写 `is_ok()` 时失败信息是空的，查不出原因
        probe_writable_dir(&base).unwrap_or_else(|e| panic!("探测应当成功，却失败：{e}"));
        assert!(base.is_dir(), "探测应该把目录建出来");
        // 探测文件不该留下垃圾
        assert!(!base.join(".git-nest-writable").exists(), "探测文件应被删掉");

        // 反向验证：探测**真的**会失败，而不是恒真。
        // 拿一个已经存在的**文件**当目录用 → create_dir_all 必然失败。
        let file = base.join("not-a-dir");
        std::fs::write(&file, b"x").unwrap();
        assert!(
            probe_writable_dir(&file).is_err(),
            "对文件路径的探测必须失败，否则这个探测证明不了任何事"
        );

        std::fs::remove_dir_all(&base).unwrap();
    }
}
