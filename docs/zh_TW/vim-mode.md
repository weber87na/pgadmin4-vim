# pgAdmin 4 Vim 模式：功能盤點與操作說明

適用於本分支的 Query Tool SQL 編輯器。Vim 由內建前端套件
`@replit/codemirror-vim 6.4.0` / `codemirror-vim-core 0.1.0` 提供，
不需要安裝 Vim、Neovim，也不需要 `init.lua`。

## 開啟方式

開啟 **File → Preferences → Query Tool → Editor**：

- **Enable Vim mode?**：開啟 Vim 操作，變更立即生效。
- **Show Vim mode indicator?**：顯示或隱藏模式指示列。

關閉模式指示列仍可使用 `/`、`?`、`:`，輸入時會顯示命令列。
調整指示列或其他設定時，現有模式及尚未輸入完的命令會保留。

以下按鍵區分大小寫，例如 `J` 是 **Shift+J**，`<Esc>` 是 Escape。
連寫表示依序按鍵，例如 `ciw` 是依序按 `c`、`i`、`w`。

## 功能盤點

「既有」表示由鎖定版本的 Vim 引擎提供，並非這次重新實作。

| 類別 | 主要指令 | 狀態 |
| --- | --- | --- |
| 模式 | `i a I A o O R`、`Esc`、`Ctrl+[` | 既有 |
| 移動與次數 | `h j k l`、`w W b B e E ge`、`0 ^ $`、`gg G`、`3w`、`2dd` | 既有 |
| 字元／段落跳轉 | `f F t T`、`; ,`、`%`、`{ }` | 既有 |
| 編輯與縮排 | `d c y p P x r`、`dd cc yy`、`>> << =` | 既有 |
| 合併行 | `J`、`gJ` | 既有，新增回歸覆蓋 |
| 文字物件 | `iw aw iW aW`、括號、引號文字物件，例如 `di(`、`ci"` | 既有 |
| 選取 | `v V`、`Ctrl+v`／`Ctrl+q`、`o`、`gv` | 既有 |
| 搜尋 | `/ ? n N * # g* g# gn gN`、`:noh` | 既有；修復指示列切換後命令列消失 |
| 取代 | `:s/a/b/`、`:%s/a/b/g`、確認旗標 `c` | 既有；使用引擎支援的正規表示式語法 |
| 復原與重做 | `u`、`Ctrl+r`、`.` | 既有 |
| 暫存器與巨集 | `"ayy`、`"ap`、`qa … q`、`@a`、`@@` | 既有 |
| 標記與跳躍 | `ma`、`'a`、`` `a ``、`Ctrl+o`／`Ctrl+i` | 既有 |
| 大小寫、數字、註解 | `~ gu gU`、`Ctrl+a`／`Ctrl+x`、`gcc`／`gc{motion}` | 既有 |
| Surround | `ys{motion}{符號}`、`yss{符號}`、`ds{符號}`、`cs{舊}{新}`、Visual `S{符號}` | 本次新增 |
| 摺疊 | `zc zo za zM zR` | 本次新增 |
| 儲存 SQL | `:w`、`:write` | 本次接到 pgAdmin 儲存流程 |
| 唯讀／停用保護 | 刪除、縮排、貼上、Tab、拖放等操作 | 本次補強 |

## 常用操作

### 合併行與文字物件

```text
J      將下一行接上，處理行間空白
gJ     直接接上下一行，不自動加入分隔空白
ciw    修改游標所在單字
di(    刪除括號裡的內容，保留括號
da(    刪除內容及括號
ci"    修改雙引號中的內容
gcc    切換目前 SQL 行的 -- 註解
gcj    切換目前行與下一行的註解
```

### Surround：增加、移除、更換包圍符號

```text
ysiw)  users → (users)
ysiw"  users → "users"
yss]   用中括號包住目前行的內容
ds)    (users) → users
cs)]   (users) → [users]
viwS'  選取單字後，以單引號包住
```

支援 `()`、`[]`、`{}`、單引號、雙引號及反引號；`b`、`B`、`r`
分別是圓括號、大括號、中括號的別名。

- 新增時輸入開括號會加上內側空白，例如 `ysiw(` 得到 `( users )`；
  輸入閉括號得到 `(users)`。
- 刪除／更換時指定開括號會移除內側水平空白，指定閉括號則保留空白。
- 支援計數、`.` 重複、巨集、單步復原，以及 Visual 的反向／區塊選取。
- `yss` 保留行首縮排與行尾換行，包住該行內容。
- 未完成的操作可用 `Esc` 取消；無效符號或找不到配對時不修改文字。

尋找配對時會處理 SQL 的重複引號、註解及 dollar-quoted 字串，
將 dollar-quoted 字串視為整個字串區塊；目前不會在其中尋找要移除／更換的
括號。HTML 標籤及任意自訂符號未支援，並非完整 Vim-surround 相容。

### 摺疊

```text
zc     關閉游標所在的摺疊區塊
zo     展開游標所在的摺疊區塊
za     切換展開／關閉
zM     關閉所有可摺疊區塊
zR     展開所有已摺疊區塊
2zc    依序關閉兩層巢狀區塊
2zo    展開兩層巢狀區塊
```

這些命令在 Normal 模式使用，遵循編輯器的 code folding 設定，
採用現有 SQL／PL/pgSQL 摺疊服務。沒有可摺疊區域時不修改文件。
唯讀文件也可以摺疊。

### 儲存

在 Normal 模式輸入 `:w` 或 `:write` 後按 Enter，等同觸發目前
Query Tool 的儲存 SQL 檔案流程；尚未命名的分頁會使用原有儲存對話框。
儲存錯誤、覆寫確認及路徑選擇均由 pgAdmin 處理。

目前僅支援儲存整份查詢；`:w filename`、`:w!`、範圍儲存會提示改用
`:w`，不會默默忽略參數。`:w` 不會執行 SQL，也不會提交資料庫交易。

## 快捷鍵與限制

- Vim 啟用時，Vim 已使用的按鍵優先。`Ctrl+f` 是翻頁；可用 `/` 搜尋，
  或使用 pgAdmin 的選單。未被 Vim 使用的 Query Tool 快捷鍵保留原有路徑。
- Normal 模式的 `Tab` 等同 `Ctrl+i`，向前走訪跳躍清單；`Shift+Tab`
  不會誤改縮排。Insert 模式維持 pgAdmin 原有的 Tab 縮排／補全行為。
- `,` 保留 Vim 的反向重複 `f`／`t` 搜尋功能；本分支未另外指定 Leader。
- `"+y`／`"+p` 使用引擎的系統剪貼簿支援，需要瀏覽器／Electron 提供
  Clipboard API 及允許存取；`"*` 不等同系統剪貼簿。
- 尚未加入持久化 `.vimrc`、EasyMotion、跨 Query Tool 分頁的 Vim buffer／window
  管理、`:q`／`:wq`／`ZZ`，以及完整 Vim 外掛 API。
- `zC`／`zO`／`zA`、`zr`／`zm` 及 Visual 模式的摺疊尚未實作。
- 本專案提供編輯器內的 Vim 操作，不能據此宣稱完整 Vim／Neovim 相容。

## 開發與驗證

在 `web` 目錄安裝鎖定版本並執行 Vim 與編輯器回歸測試：

```powershell
corepack yarn install --immutable
corepack yarn jest --runInBand --runTestsByPath regression/javascript/components/CodeMirrorVimCore.spec.js regression/javascript/components/CodeMirrorVimStatus.spec.js regression/javascript/components/CodeMirrorVimFolding.spec.js regression/javascript/components/CodeMirrorVimSurround.spec.js regression/javascript/components/CodeMirrorVimIntegration.spec.js regression/javascript/components/CodeMirror.spec.js regression/javascript/components/CodeMirrorCustomEditor.spec.js
corepack yarn bundle
```

測試使用真實 CodeMirror／Vim 引擎驗證文字、游標、選取、模式、儲存回呼與
摺疊狀態。Windows Electron 啟動、中文輸入法及系統剪貼簿仍需在實際桌面環境驗收。
`Vim editor regression` GitHub Actions 會在此 fork 的 `main` 分支 PR／推送時，
於 Linux 與 Windows 執行上述測試及相關檔案的 ESLint。
