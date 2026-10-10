/*
  仓库那一格的**默认图**：没有 logo 时显示它（原来用的是 lucide 的 FolderGit2）。

  文件在**仓库根部的 `docs/`** 下，不在 `apps/web` 里：它是这个项目自己的素材
  （README 里也要用它），不是 web 应用私有的一个资源。代价是从组件那边要往上跳
  五层，所以那条路径只出现在这一个文件里——散在各组件里迟早会有一处写错。

  `vite.config.ts` 里的 `server.fs.allow: ['..']` 已经放开了仓库根部，dev server
  读得到；构建时它按普通资源被打进去。
*/
import folderUrl from '../../../../../docs/folder.svg'

export { folderUrl }
