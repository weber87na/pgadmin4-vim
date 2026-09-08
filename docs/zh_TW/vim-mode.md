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

「既有」表示由鎖定版本的 Vim 引擎提供；「第一批」已在 PR #21 合併；
「第二批」與「第三批」接續在 PR #22 補上原生指令。
Surround 是外掛式擴充，不列為原生 Vim 功能。

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
| Surround（非原生） | `ys{motion}{符號}`、`yss{符號}`、`ds{符號}`、`cs{舊}{新}`、Visual `S{符號}` | 第一批新增 |
| 基本摺疊 | `zc zo za zM zR` | 第一批新增；第二批串接層級狀態 |
| 遞迴摺疊 | `zC zO zA` | 第二批新增 |
| 摺疊層級 | `zm zr`、`2zm 2zr` | 第二批新增 |
| 選取範圍摺疊 | Visual `zc zo zC zO` | 第三批新增 |
| Ex 範圍摺疊 | `:foldopen[!]`、`:foldclose[!]` | 第三批新增 |
| 顯示游標／重算摺疊 | `zv zx zX` | 第三批新增 |
| 整行複製／搬移 | `:copy`／`:co`／`:t`、`:move`／`:m` | 第二批新增 |
| 排序 | `:sort u`、`:sort n` | 既有；第二批新增回歸覆蓋 |
| 條件批次編輯 | `:g/pattern/d`、`:v/pattern/d` | 既有；第二批新增回歸覆蓋 |
| 範圍普通模式操作 | `:%normal x` | 既有；第二批新增回歸覆蓋 |
| Ex 行操作 | `:1,2join`、`:2delete` | 既有；第二批新增回歸覆蓋 |
| 儲存 SQL | `:w`、`:write` | 第一批接到 pgAdmin 儲存流程 |
| 唯讀／停用保護 | 刪除、縮排、貼上、Tab、拖放等操作 | 第一批補強 |

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
zC     關閉包含游標行的所有巢狀摺疊
zO     遞迴展開目前關閉的區塊
zA     遞迴切換目前區塊
zm     降低一層展開層級，摺疊更多內容
zr     提高一層展開層級，顯示更多內容
2zm    降低兩層展開層級
2zr    提高兩層展開層級
```

上述命令在 Normal 模式使用；`zc/zo/zC/zO` 也支援下方的 Visual 操作。
所有摺疊命令遵循編輯器的 code folding 設定，
採用現有 SQL／PL/pgSQL 摺疊服務。沒有可摺疊區域時不修改文件。
唯讀文件也可以摺疊。

層級以語言服務回傳的巢狀區塊計算，各編輯器獨立保存：`zM` 設為 0，
`zR` 設為目前最大深度；`zm/zr` 依次數調整並重新套用，會重設個別區塊的手動開關。
`zC` 不主動關閉未包含游標行的兄弟區塊；`zA` 關閉目前區塊及其子區塊。
初次使用層級命令時，以全部展開為起點。這是 CodeMirror 語法摺疊整合，
尚未提供 Vim 的 `foldmethod`／`:set foldlevel` 選項。

### 選取範圍摺疊與重新計算（第三批）

```text
V … zc              將選取範圍內的區塊關閉一層
V … zo              將選取範圍內的區塊展開一層
V … zC              關閉所有與選取範圍相交的巢狀區塊
V … zO              展開選取範圍內的所有巢狀區塊
:10,30foldclose     關閉第 10～30 行範圍內的一層區塊
:10,30foldopen!     遞迴展開第 10～30 行範圍內的區塊
:%foldclose!        關閉整份文件的所有語法區塊
:'<,'>foldopen      展開上次 Visual 選取範圍內的一層區塊
zv                  展開足夠的區塊，讓游標所在行不被摺疊
zX                  重算語法摺疊，重新套用既有展開層級
zx                  同 zX，並展開游標所在行需要的區塊
```

- Visual 字元、整行與區塊選取都按涉及的行處理，支援反向選取。
  操作完成後回到 Normal 模式；可用 `gv` 恢復上一個選取。
- Visual `zc/zo` 每次處理一層，不套用 Normal 模式的次數。
  選取已關閉區塊的標頭時，該摺疊行代表其整個隱藏範圍。
- `zC/zO` 的遞迴範圍包含部分相交的區塊；不會主動切換範圍外的兄弟區塊。
- Ex 可縮寫為 `:foldc`、`:foldo`；省略來源範圍時使用目前行。
  `!` 表示遞迴操作，其他參數與無效行號會提示錯誤。
- `zx/zX` 重設手動開關，但保留 `zm/zr/zM/zR` 設定的層級；它們不建立手動摺疊。
- 所有上述操作均不修改 SQL 文字，唯讀編輯器也能使用。

### 第三批逐項驗收

| 指令 | 實作結果 | 回歸驗證 |
| --- | --- | --- |
| Visual `zc` | 關閉範圍內一層 | 正向／反向、字元／整行／區塊選取、多個區塊 |
| Visual `zo` | 展開範圍內一層 | 保留隱藏子區塊、返回 Normal |
| Visual `zC` | 遞迴關閉相交區塊 | 部分選取的父區塊、兄弟區塊隔離 |
| Visual `zO` | 遞迴展開選取區塊 | 已關閉標頭、巢狀區塊、局部範圍 |
| `:foldclose[!]` | Ex 範圍關閉 | 行範圍、`%`、標記、縮寫與無效參數 |
| `:foldopen[!]` | Ex 範圍展開 | 一層／遞迴、Visual 命令列、唯讀整合 |
| `zv` | 顯示游標行 | 保留其他子區塊、Query Tool 整合 |
| `zX` | 重算並重新套用層級 | 手動開關重設、修改 SQL 後重算 |
| `zx` | 重算並顯示原游標行 | 保留原游標位置、範圍外區塊保持關閉 |

實作與測試沿用 `vimFolding.js`、`CodeMirrorVimFolding.spec.js`，
並在 `CodeMirrorVimIntegration.spec.js` 驗證實際 Query Tool 的語法摺疊服務。

### 整行複製與搬移

```text
:1,3copy $    複製第 1～3 行到文件最後
:1,3t $      同上，:t 是 :copy 的別名
:2move 0     將第 2 行搬到第一行之前
:3,5m 1      將第 3～5 行搬到第 1 行之後
:t .         複製目前行到其後
:m +2        將目前行搬到目前行往下兩行的位置之後
:'<,'>t $    將 Visual 選取涉及的整行複製到最後
:%copy 0     將整份文件複製到第一行之前
:1t 'a-1     將第 1 行複製到標記 a 所在行之前
```

- 目的地表示「插在該行之後」，`0` 表示文件最前；搬移時的行號以修改前為準。
- 命令和數字目的地之間請留空格。支援 `.`, `$`, 行號、已設定的英文字母標記、
  Visual 標記，以及 `+`／`-` 位移；沒有來源範圍時使用目前行。
- 來源範圍沿用引擎的 Ex 解析，包含 `%`、數字範圍與 Visual 標記。
- 保留縮排、Unicode 與 CodeMirror 中的空白行，游標移到結果最後一行的首個非空白字元。
- 不覆寫 yank／delete 暫存器；搬移範圍內的 Vim 標記跟隨文字。
- 每次操作可用一次 `u` 復原、`Ctrl+r` 重做；`@:` 重跑上一個 Ex 命令。
  Ex 行操作不以 `.` 重播。
- 搬入來源內部、無效行號、未設定標記、唯讀／停用狀態都不修改文件。
  目的地搜尋式 `/pattern/`、命令串接 `|`、`!` 旗標目前不支援，會提示錯誤。

### 第二批逐項驗收

| 指令 | 實作結果 | 回歸驗證 |
| --- | --- | --- |
| `zC` | 關閉游標所在的各層區塊 | 巢狀區塊、兄弟區塊不受影響 |
| `zO` | 遞迴展開關閉的區塊 | 子區塊展開、其他區塊保持關閉 |
| `zA` | 遞迴切換目前區塊 | 全部子區塊、局部子區塊 |
| `zm` | 降低展開層級 | 次數、零下限、手動開關重設 |
| `zr` | 提高展開層級 | 次數、超過最大深度、編輯器隔離 |
| `:copy`／`:co` | 複製整行 | 範圍、首尾插入、暫存器、復原 |
| `:t` | 複製命令別名 | Visual、標記、空白行、Unicode、`@:` |
| `:move`／`:m` | 搬移整行 | 上下搬移、首尾換行、標記、無效目的地、復原／重做 |

實作位置：`vimFolding.js`、`vimExLines.js`；測試位於
`CodeMirrorVimFolding.spec.js`、`CodeMirrorVimExLines.spec.js`。
`CodeMirrorVimIntegration.spec.js` 另外驗證 Query Tool 接線、設定切換與唯讀／停用保護。
原生語意參照 [Vim 摺疊說明](https://vimhelp.org/fold.txt.html) 與
[Vim 行複製／搬移說明](https://vimhelp.org/change.txt.html#%3Acopy)。

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
- 持久化 `.vimrc`、跨 Query Tool 分頁的 Vim buffer／window 管理、`:q`／`:wq`／`ZZ`
  及完整 Vim 外掛 API 尚未支援。EasyMotion 是外掛功能，亦未加入。
- `zf/zd` 手動建立／刪除摺疊、`[z/]z/zj/zk` 摺疊跳轉，以及 Vim 摺疊選項尚未實作。
  Visual 模式目前支援 `zc/zo/zC/zO`，尚未加入 Visual `za/zA`。
- `g;`／`g,` 變更清單、Visual `g Ctrl+a`／`g Ctrl+x` 遞增序列仍待實作。
  既有 Normal `Ctrl+a`／`Ctrl+x` 使用 JavaScript Number；不保證大整數及所有
  `nrformats` 行為與原生 Vim 一致。
- Ex 解析仍由現有引擎提供；未宣稱完整 Vim 地址、正規表示式、Vimscript 或外部 shell 相容。
- 本專案提供編輯器內的 Vim 操作，不能據此宣稱完整 Vim／Neovim 相容。

## 開發與驗證

在 `web` 目錄安裝鎖定版本並執行 Vim 與編輯器回歸測試：

```powershell
corepack yarn install --immutable
corepack yarn jest --runInBand --runTestsByPath regression/javascript/components/CodeMirrorVimCore.spec.js regression/javascript/components/CodeMirrorVimStatus.spec.js regression/javascript/components/CodeMirrorVimFolding.spec.js regression/javascript/components/CodeMirrorVimExLines.spec.js regression/javascript/components/CodeMirrorVimSurround.spec.js regression/javascript/components/CodeMirrorVimIntegration.spec.js regression/javascript/components/CodeMirror.spec.js regression/javascript/components/CodeMirrorCustomEditor.spec.js
corepack yarn bundle
```

測試使用真實 CodeMirror／Vim 引擎驗證文字、游標、選取、模式、儲存回呼與
摺疊狀態。Windows Electron 啟動、中文輸入法及系統剪貼簿仍需在實際桌面環境驗收。
`Vim editor regression` GitHub Actions 會在此 fork 的 `main` 分支 PR／推送時，
於 Linux 與 Windows 執行上述測試及相關檔案的 ESLint。
