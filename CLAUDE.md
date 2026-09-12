# drone-tenders — 維護規則

零建置靜態站。Cloudflare Pages Git 連動 main，build command 空白、輸出 `/`。
資料由 `node scripts/build.mjs` 產生，GitHub Actions 每週一自動跑並 commit；本機要更新資料也只跑這一行。
不要把 `data/cache/` 進版控。

規格在 `SPEC.md`。設計鐵則：質感、少字、按鈕無 AI 感（細框或底線，無漸層無 emoji）。
公開場合作者一律寫 Adam Pan，聯絡只放 wizard32232002@gmail.com。
資料引用政府電子採購網必須註明出處（頁尾已有）。

站內連結用乾淨網址（`/tenders`、`/vendors`…），Cloudflare Pages 會自動對到 `.html`；本機預覽用 `npx wrangler pages dev .`，用 `python -m http.server` 的話要自己補 `.html`。
