# 無人機標案觀測站 — 規格（SPEC）

網址：https://tenders.skyfaring.net（備用 https://skyfaring-drone-tenders.pages.dev）
Repo：`lioneer32232002-commits/drone-tenders`（公開）
定位：把政府電子採購網裡所有無人機相關標案整理成一個可讀、可查、每週自動更新的觀測站。
台灣目前只有通用標案搜尋，沒有無人機專門的錢流分析。這是第一個。

## 一、資料源

- g0v 標案 API：`https://pcc-api.openfun.app/`（CORS 開放；請求要帶 `User-Agent`，否則 403）
  - 搜標題：`/api/searchbytitle?query=<kw>&page=N`，每頁 100 筆，回傳 `total_pages`
  - 單一標案全部公告：`/api/tender?unit_id=<>&job_number=<>` → `records[]`，每筆有 `brief.type`（公告類型）與 `detail`（扁平化欄位，key 用冒號分層）
- 授權：政府採購網著作權聲明允許非營利／研究／評論引用並註明出處。頁尾必須註明「資料來源：政府電子採購網，經 g0v 標案 API 取得」。
- 資料起自 2000 年。

### 關鍵字（標題搜尋，全部跑，之後以 `unit_id + job_number` 去重）
`無人機`、`無人飛行載具`、`無人載具`、`UAV`、`UAS`、`空拍機`、`多旋翼`、`遙控飛行`、`無人飛機`、`無人直升機`、`反無人機`、`無人機反制`、`定翼機`、`垂直起降`
（2026-09 實測筆數：無人機 3470、無人飛行載具 641、無人載具 526、UAV 467、空拍機 562、多旋翼 321）

### 領域旗標 `domain`
`無人載具` 會撈到船艇車輛。用標題判斷：含「船、艇、水下、水面、潛、車、地面」且不含「機、飛」→ `sea`/`ground`；否則 `air`。網站預設只顯示 `air`，篩選器可切到全部。

## 二、產出資料（由 `scripts/build.mjs` 產生，commit 進 repo）

### `data/tenders.json`
```json
{
  "generated_at": "2026-09-14T01:00:00+08:00",
  "source": "政府電子採購網（經 g0v 標案 API）",
  "keywords": ["無人機", "..."],
  "tenders": [
    {
      "id": "3.76.58.2/1150605",
      "title": "新竹市警察局115年度第1次遙控無人機採購案",
      "agency": "新竹市警察局",
      "agency_id": "3.76.58.2",
      "agency_group": "地方警政",
      "category": "警政",
      "domain": "air",
      "procurement_type": "財物",
      "subject_class": "496航空器,太空船及其零件",
      "method": "公開招標",
      "award_method": "最有利標",
      "status": "awarded",
      "budget": 3200000,
      "award_amount": 3200000,
      "award_date": "2026-08-17",
      "first_notice_date": "2026-06-29",
      "last_notice_date": "2026-09-02",
      "bidders_count": 1,
      "winners": [
        {"name": "翔隆航太股份有限公司", "id": "24736311", "amount": 3200000, "sme": true,
         "origins": [{"country": "美國", "amount": 3200000}]}
      ],
      "national_security": true,
      "framework": false,
      "pcc_url": "https://web.pcc.gov.tw/...",
      "announcements": [{"date": "2026-06-29", "type": "公開招標公告"}, {"date": "2026-09-02", "type": "決標公告"}]
    }
  ]
}
```

欄位規則：
- `status`：有「決標公告」→ `awarded`；只有「無法決標公告」→ `failed`；有招標公告但截止日已過且無決標 → `closed`；招標中 → `open`；只有「公開徵求廠商提供參考資料」「公開閱覽」→ `pre`。同一標案有多次公告以最新一筆決定。
- 金額：字串「3,200,000元」→ 整數；沒有或「不公開」→ `null`。共同供應契約通常沒有總額，維持 `null`，不要估。
- 民國日期 `115/08/17` → `2026-08-17`。
- `winners`：從 `投標廠商:投標廠商N:是否得標 = 是` 取；`決標金額` 為該廠商金額；`原產地國別` 從 `決標品項:第K品項:得標廠商M:原產地國別:原產地國別` 與對應「原產地國別得標金額」取，多品項要合併同國別加總。廠商名稱去掉括號內英文名。
- `category`（依標題與機關名判斷，順序優先）：`國防`（國防部／軍備局／中科院／國軍／海巡署含「反制」）、`反制`（標題含反制、反無人機、防禦系統、偵測干擾）、`警政`（警察局、警政署、調查局）、`消防救災`（消防局、災防、搜救、防災）、`農林漁業`（農業部、林業、農糧、農改場、漁業、噴灑、農藥）、`測繪巡檢`（測量、測繪、航拍、巡檢、橋梁、電力、台電、水利、河川、國土）、`教育研究`（大學、學校、研究、教學、訓練、實習、考照）、`環境監測`（環保局、空污、水質）、`其他`。
- `agency_group`：依機關代碼首段與名稱歸成 `國防`、`中央部會`、`地方政府`、`國營事業`、`學校`、`其他`。
- `bidders_count` 從 `投標廠商:投標廠商家數`。

### `data/summary.json`（前端首頁直接讀，避免載大檔）
- `totals`：全部／今年／本季的 件數、決標總額、招標中件數
- `by_quarter[]`：`{q: "2026Q3", awarded_count, awarded_amount, open_count}`（2016Q1 起）
- `by_year[]`：同上（2010 起）
- `by_category[]`、`by_agency_group[]`：件數與金額
- `top_agencies[]`（前 20，件數與金額）、`top_vendors[]`（前 20，件數、金額、主要客戶機關前 3）
- `by_origin[]`：得標金額依原產地國別加總（台灣、美國、中國、日本、其他），另附 `by_origin_year[]`
- `recent[]`：最近 60 天的公告，每筆帶 id、date、type、title、agency、amount
- `vendor_agency_edges[]`：`{vendor, agency, count, amount}` 供關係圖
- `data_notes`：原產地資訊有多少比例的決標沒填、共同供應契約無金額件數

### 更新
- `.github/workflows/update.yml`：每週一 01:00 UTC（台灣 09:00）+ `workflow_dispatch`，Node 22，跑 `node scripts/build.mjs`，資料有變才 commit（訊息 `data: weekly update YYYY-MM-DD`）並 push main → Cloudflare Pages 自動部署。
- 抓取要有節制：並發 ≤ 4、每請求間隔 ≥ 150 ms、失敗重試 3 次退避。完整重抓一次應在 15 分鐘內。可用 `data/cache/`（gitignore）做本機快取，CI 上不依賴。
- 若 API 掛掉，build 失敗即可，不要 commit 空資料。

## 三、網站（零建置靜態站，Cloudflare Pages build command 空白、輸出 `/`）

技術：純 HTML + CSS + vanilla JS（ES modules）+ d3 v7（CDN）。字體 Noto Serif TC（標題）+ Noto Sans TC（內文），與 logbook.skyfaring.net 同一套質感（可參考 `D:/repos/logbook/assets/style.css`）。`<meta name="color-scheme" content="light dark">`，深淺色都要好看。

### 頁面
1. `index.html` 總覽
   - 頂部一句大字（襯線，數字用等寬或 tabular-nums）：「今年到目前為止，台灣政府決標了 N 件無人機採購，共 X 億元。」下方小字：資料更新時間、招標中 N 件。
   - 季度長條圖（2016 起，決標金額），滑過顯示件數與金額。
   - 「錢從哪裡來」：機關群組（國防／中央／地方／國營／學校）金額占比，用細長的堆疊條，不用圓餅。
   - 「錢到哪裡去」：得標廠商前 10，橫條。
   - 「哪裡製造」：原產地國別金額占比（台灣／美國／中國／日本／其他），一條堆疊條 + 逐年變化的小圖。這是全站最重要的一張圖，要放明顯。
   - 「最近」：最近 60 天公告列表（日期、機關、標題、類型、金額），最多 15 筆，連到列表頁。
2. `tenders.html` 全部標案
   - 篩選：年份、狀態、類別、機關群組、領域（預設 air）、關鍵字搜尋；URL query 同步，可分享。
   - 表格：日期、機關、標案名稱、預算、決標金額、得標廠商、狀態；點展開顯示公告時間軸、投標家數、原產地、原始連結。
   - 從 `tenders.json` 載入（可能 3–5 MB，加 loading 狀態；考慮 gzip 已由 Cloudflare 處理）。
3. `vendors.html` 廠商
   - 排行表（件數、金額、中小企業、主要客戶），點廠商展開其所有得標案。
   - 廠商×機關關係圖（d3 力導向或弦圖，節點 ≤ 60，太多就取前 N）。
4. `agencies.html` 機關
   - 依群組分區的排行，點機關展開其標案。
5. `about.html` 方法
   - 資料來源與授權、關鍵字清單、欄位定義、已知限制（標題關鍵字會漏掉沒寫「無人機」的案子；共同供應契約無總額；原產地由機關自填；更正公告以最新為準）、更新頻率、聯絡：wizard32232002@gmail.com、作者 Adam Pan。

### 設計鐵則（使用者原話：「有質感好閱讀，文字不要太多，按鈕不要有 AI 感」）
- 編輯感：大留白、襯線大標、細線分隔、表格斑馬紋淡到幾乎看不見。
- 按鈕與篩選器：只用細框或底線文字，無漸層、無圓角膠囊、無陰影、無 emoji、無三欄特色卡。
- 每頁正文不超過三句話。圖表旁只有一句說明。
- 數字用 `font-variant-numeric: tabular-nums`；金額顯示「1.23 億」「4,500 萬」，小於一萬顯示整數。
- 手機優先可讀，表格在窄螢幕改成卡片式。
- 頁頭：左 `Skyfaring` 連回 https://skyfaring.net，中站名，右五個頁籤（底線式）。頁尾：資料來源、更新時間、作者、GitHub 連結。
- 可以放一張 Wikimedia Commons 上 CC 授權的台灣無人機照片（如中科院銳鳶、騰雲、或國軍演訓無人機）在 about 頁或首頁下半，圖說必附作者與授權；找不到合適的就不放。

### SEO
- 每頁 `<title>` 前段放關鍵字：「台灣無人機標案觀測站｜政府無人機採購決標金額、得標廠商、原產地」等；`description`、OG、canonical、`sitemap.xml`、`robots.txt`。
- `_headers`：基本安全標頭、`data/*.json` 快取 1 小時。

## 四、驗收
- `node scripts/build.mjs` 在本機跑完產出兩個 JSON，件數 ≥ 1500，決標有金額的 ≥ 800。
- 抽 10 筆決標案人工對照政府採購網原頁（金額、廠商、日期）。
- 五個頁面在手機寬度（390px）與桌面都截圖檢查。
- Lighthouse 可及性 ≥ 90。
