# 無人機標案觀測站

把政府電子採購網裡所有跟無人機有關的標案，整理成一個可讀、可查、每週自動更新的觀測站：
每季決標金額、錢從哪個機關出、錢流到哪些廠商，以及全站最重要的一張圖——這些無人機到底哪裡製造。
台灣目前只有通用的標案搜尋，沒有無人機專門的錢流分析，這是第一個。
網站：<https://tenders.skyfaring.net>

資料來自[政府電子採購網](https://web.pcc.gov.tw/)，透過 g0v 社群維護的[標案 API](https://pcc-api.openfun.app/) 取得，
收錄自 2000 年起，用 14 組標題關鍵字搜尋後以機關代碼加案號去重。
`scripts/build.mjs` 產生 `data/tenders.json` 與 `data/summary.json` 並 commit 進 repo，
GitHub Actions 每週一台灣時間早上九點跑一次，資料有變動才更新。
欄位定義、判斷規則與已知限制寫在站上的[方法](https://tenders.skyfaring.net/about.html)頁。

前端是零建置靜態站：純 HTML、CSS 與 vanilla JS（ES modules），沒有打包工具、沒有框架，
Cloudflare Pages 的 build command 留空、輸出目錄設 `/`，push 到 `main` 就自動上線。
本機預覽跑 `python -m http.server 8787` 後開 <http://localhost:8787/> 即可。
桌面與 390px 寬的頁面截圖放在 [`screenshots/`](screenshots/)。

---

資料來源：政府電子採購網，經 g0v 標案 API 取得。作者 Adam Pan。
