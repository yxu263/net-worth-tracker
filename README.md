# Net Worth Tracker

Local-first net worth tracker built with Next.js, TypeScript and Tailwind CSS. It builds to **plain static files** (no server), so it can be hosted free on GitHub Pages and opened from any computer or phone.

```
public repo (this code) --GitHub Actions--> GitHub Pages: https://<you>.github.io/<repo>/
private repo            <-- net-worth-data.json, read/written by the app with your token
Cloudflare Worker       <-- price proxy to Yahoo Finance (browsers cannot call Yahoo directly)
```

## Publish (one-time setup)

1. **Price proxy.** Either option works; the app only needs a URL that answers `<url>?symbol=VTI`.
   - **Netlify** (works on the Ford network, which blocks `*.workers.dev`): after step 2, sign in at netlify.com with GitHub -> *Add new site -> Import an existing project* -> pick the app repo -> *Deploy*. `netlify.toml` deploys only `netlify/functions/quote.mjs`. Proxy URL: `https://<site-name>.netlify.app/quote`.
   - **Cloudflare**: *Workers & Pages* -> *Create* -> *Worker*, paste `cloudflare-worker/worker.js`, deploy. Proxy URL: `https://….workers.dev`.

   Both only answer requests from the origins in their `ALLOWED_ORIGINS` list (`https://yxu263.github.io` and `http://localhost:3000`).
2. **App repo (public).** Create a public repo (e.g. `net-worth-tracker`) on github.com and push this folder. `.gitignore` already excludes `node_modules`, build output and the personal `data/` folder. In the repo: *Settings -> Pages -> Source: GitHub Actions*. The workflow in `.github/workflows/deploy.yml` builds and publishes on every push to `main`.
3. **Data repo (private).** Create a private repo (e.g. `net-worth-data`) and tick *Add a README* so the `main` branch exists.
4. **Token.** GitHub -> *Settings -> Developer settings -> Fine-grained tokens*: repository access = only the data repo, permission *Contents: Read and write*.
5. Open the Pages URL, click the gear (**Settings**), enter the Worker URL (press **Test**) and the GitHub owner, data repo and token, then **Save settings**. Repeat step 5 on each device; the first sync on a device with no data loads the GitHub copy automatically.

The token and Worker URL are stored only in each browser's `localStorage`, never in the synced file.

## Run on this PC (no install)

Double-click **`Start Net Worth Tracker.cmd`**. It serves the already-built app in `out\` at http://localhost:3000 using Windows' built-in web server (`scripts\serve.ps1`): no Node.js, no admin rights, no firewall prompt. Keep the window open while using the app. Once the app is on GitHub Pages, set `APP_URL` in the `.cmd` and it opens that instead.

`out\` must be rebuilt (`npm ci` then `npm run build`, which needs Node.js) only after changing the source code.

## Run locally (development)

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # static site in out/
```

Prices are fetched in the browser (`src/lib/pricing.ts`) through the Worker from Yahoo Finance's chart endpoint; only ticker symbols are sent. The app records the **latest trade price**, and labels which one it got: the live (exchange-delayed) quote while the US regular session is open, that day's official close once the bell rings, and the previous session's close before the open or on weekends and holidays.

## Sync

With GitHub sync on, the app pulls on open and when the tab regains focus, and pushes a few seconds after any change. If only one side changed it simply pulls or pushes; if both changed (two devices edited offline) the records are merged, newer edit wins per account/holding/dated balance. Deletions are recorded as markers that sync too, so a record deleted on one device stays deleted after a merge; re-importing it later brings it back. Today's automatic snapshot and price refresh wait for the first pull so a stale device never overwrites newer balances. The header shows sync status; click it for details.

## Allocation

The **Allocation** tab shows assets by class: US stocks, international stocks, bonds, cash, real estate, other. Classify each ticker once (it applies in every account holding it) and each account's own balance: the cash in a brokerage account, or the whole value of an imported total such as a 401(k). Cash and savings accounts default to Cash and property to Real estate; anything else stays *Unassigned* until chosen. Holdings linked to an imported total are not counted again, matching the account total. Untick **Include property** for an investable-assets view. Debts are not subtracted.

## Today's dollars (inflation)

The **Today's dollars** toggle above the history chart restates past balances in today's purchasing power using the official US CPI-U (BLS series CUUR0000SA0, monthly, built into `src/lib/cpi-data.ts`; months after the table ends use the assumed rate). The same toggle in **Forecast** discounts every projected figure by the assumed annual inflation set there (default 2.5%, synced with your data). The toggle itself is remembered per device.

## Goals

The **Goals** tab tracks targets for net worth, one account's balance, or paying off a debt, with progress and an estimated date from the Forecast assumptions (month by month, up to 50 years). Add an optional target date to see *On track* or *Behind*. Debt progress is measured from the highest balance on record. With **Today's dollars** on, targets are read in today's dollars.

## Export and import

All import and export actions live in the **Data** menu in the header (next to Settings). **Export…** opens a dialog with:

- **Daily balance history (CSV)** for all or selected accounts and debts, optional date range. Layout is either one column per account (plus Total) for spreadsheets, or `Date,Balance,Account` rows, the same format **Bulk import CSVs** reads. *Every calendar day* carries each balance forward between recorded changes; untick it to export only recorded dates. Debts are negative.
- **Current positions (CSV)**: accounts, debts and holdings as of today; re-import with **Import CSV**.
- **Full backup (JSON)**: everything, including forecast settings and all history. **Import backup** on another device replaces that device's data after a confirmation.

## Included

- Accounts and liabilities create, edit, and delete flows
- Manual holdings grouped by ticker with accounts nested underneath, and per-ticker expected returns
- Manual holdings with ticker, quantity, cost basis, and automatic price lookup
- Automatic internet price lookup: a new or edited holding is priced immediately; while the market is open every ticker re-quotes at most **once an hour** (only when the tab is visible), which keeps the public Yahoo endpoint well clear of rate limiting. Outside market hours prices settle on the most recent close. Use **Update prices** in the Holdings tab to refresh on demand at any time.
- Each price is tagged with its basis — a green **Live** pill during the session, otherwise `Close` or `Prev close` with the trading date, with the exact timestamp on hover
- One-day percentage change per holding, measured against the previous session's close, shown in the holdings table and in Top holdings
- Batch price API at `/api/prices?tickers=VTI,VFIAX,BTC-USD` covering stocks, ETFs, mutual funds, and crypto
- Single **Accounts & debts** tab holding accounts, property, liabilities, and top holdings
- Account list sorting by balance (high to low, low to high) or name (A to Z, Z to A)
- Property accounts are listed in their own card, above liabilities
- Net-worth history line chart with This month / 30 day / 90 day / YTD / 1 year / 5 year / all-time windows and hover tooltips showing the value plus change since the start of the window
- Selecting an account in the Accounts tab retargets that same chart to the account's own balance history, with a back link to return to total net worth
- Automatic daily point-in-time snapshots
- CSV import and export
- Idempotent per-account daily balance snapshots
- Account types: cash/checking, savings, investment, retirement, property, other
- One account dialog that edits cash and derives the total from cash plus linked holdings
- Holding forecasts with editable expected annual returns and 1–30 year projections
- Per-account monthly contributions with optional inflation growth, holding allocation, and an optional stop-contributing year
- Mortgage, loan, and credit card payoff projections from balance, rate, and principal & interest payment
- Account history CSV import with validation, a review step, an overwrite warning, and a downloadable template
- No bank credentials, email access, or third-party account linking

## Account history CSV

Use **Import from data folder** on the dashboard and pick a folder (for example this project's `data\` folder); every `.csv` file in it is read by the browser and shown in a confirmation summary before anything is written. Alternatively, from **Accounts & debts**, choose **Bulk import CSVs** to select one or more source files, or download the template and import a UTF-8 CSV with exactly this header:

```csv
Date,Balance,Account
2026-01-31,8420,checking
2026-02-29,8510,checking
```

The importer also accepts the source files exported by the tracker in this project: `Date,Balance,Account`, with dates in either `YYYY-MM-DD` or `M/D/YYYY`. Account names are normalized into stable IDs. Missing asset accounts are created automatically; `Home` is created as a property account. Names containing `debt`, `mortgage`, `loan` or `credit`, names that already exist as a liability, and accounts whose imported balances are all negative are created as liabilities. Debt history is stored as signed (negative) snapshots, while the liability's current balance is shown as a positive amount. The latest dated row updates the account or liability balance.

Duplicate account/date rows are handled last-row-wins within the selected files and across imports. Invalid rows reject the import with a concise file/row error and existing data is preserved. Creating or editing an account or importing the main CSV also automatically upserts the current-date account snapshot.

### Automatic history

There is no *Save snapshot* button: history records itself. Opening the app writes today's figures, and they are re-recorded whenever the numbers move — a price refresh, an account edit, a CSV import. If you leave the app open past midnight it notices the new day and records that day too, so a long-running tab does not go stale.

Each save writes two things, both keyed to the date and both **idempotent** — saving repeatedly within a day replaces that day's entry rather than accumulating duplicates:

- One **aggregate** entry holding `assets`, `liabilities`, and `netWorth`.
- One **per-account** entry for every account, recorded at the account's displayed total, i.e. cash **plus** linked holdings for a composed account. Composed accounts therefore keep their holdings in the trend rather than dropping to bare cash.
- One **per-debt** entry for every liability, stored as a negative balance like imported debt history, so editing a debt's balance shows up in its history and in the history export.

The header shows a dot and **History saved today** once the day is recorded. Saving is deliberately skipped while the demo fallback is showing over real saved data, and while saved data is unreadable, so a bad read can never overwrite your history. Earlier dates are never rewritten — only today's entry is touched.

All dates are **local calendar dates**, never UTC. This matters in the evening: at 9pm in New York it is already tomorrow in UTC, so a UTC-based date would file tonight's figures under tomorrow and show a future point on the chart. `src/lib/date.ts` is the single source of truth — `todayIso`, `isoDate`, and `parseIso` — and everything that touches a `YYYY-MM-DD` goes through it.

History saved by an older build could already carry a tomorrow-dated row. Loading repairs that automatically: a future-dated entry is **re-dated to today**, keeping its figures, because it was really recorded now. If today already has a genuine entry that one wins and the stray rows are dropped. Past dates are never touched, and the repair is idempotent, so nothing needs to be cleared by hand.

Snapshots capture what is true *now*; they never include forecast assumptions such as monthly contributions. Because per-account balances are carried forward between dates, the two records stay consistent: the per-account entries for a date sum to that date's aggregate assets.

Both import paths (data folder and **Bulk import CSVs**) now stop at the same review dialog before writing anything. The dialog counts the files, accounts, and rows, and **warns when the import would overwrite existing dated balances with different values**, listing how many dates are affected, the earliest and latest affected date, and the accounts involved. The confirm button changes to *Overwrite and import* in that case. When every incoming row is new or identical to what is stored, the dialog says so explicitly.

## Accounts

Account editing and composition are a single dialog. Press **Edit** beside an account (or **+** to add one) and set its name, institution, type, and **cash balance**. The account total is never edited directly: it is cash plus the market value of the holdings linked to that account, so holdings are counted exactly once in net worth. Link holdings from the **Holdings** tab by selecting the account there, or edit them directly in the account dialog: change shares or cost basis, add a holding, or remove one (applied when you press Save). A new ticker that is already held in another account starts with that price, expected return and asset class; anything new is priced from Yahoo Finance on save. Longer explanations in the forms are hidden behind **?** buttons. Deleting an account, debt or holding asks for confirmation first and lists the history and linked holdings that go with it.

Account types are cash/checking, **savings**, investment, retirement, property, and other. For property and other accounts the cash field is relabelled as the account value. Cash and savings accounts compound their balance at the account's expected annual return in Forecast.

For **property** accounts the rate field is relabelled **Expected annual appreciation (%)**, since a home's value tracks the market rather than earning interest. It accepts **negative** numbers to model a declining market, and property compounds at this rate in Forecast (it is not held flat). A rate of −100% or worse is treated as a total loss over the year rather than producing an invalid figure.

The dialog updates live as you type: it shows the cash figure, linked holdings, and the resulting **Account total**, so adjusting cash immediately shows the effect. There is no pass/fail tolerance verdict. When you open an imported account for the first time and it already has holdings linked, the cash field is pre-filled with the imported total **minus** those holdings, so the account total is preserved instead of double counting. If the account has an earlier recorded total, it appears as a plain reference alongside the difference, with a **Match cash** button that back-solves the cash needed to reach it. Saving records today's account snapshot at the composed total, so the account and net-worth charts reflect the change; earlier dated history is left untouched.

Note that saving an account takes it under manual control: CSV imports refresh balances only for accounts that have never been edited, so once you compose an account by hand, later imports will not overwrite your cash figure.

Accounts, property, liabilities, and top holdings all live on the single **Accounts & debts** tab. The left column lists your accounts with a **Sort** control (balance high to low, balance low to high, name A to Z, name Z to A), sorting on the displayed total. The right column stacks Property, Liabilities, and Top holdings. Accounts with the Property type are shown only in the Property card so they are never listed twice, and their figure is labelled "value" rather than "cash". Top holdings shows each position's one-day percentage change, measured against the previous session's close as returned by Yahoo Finance.

Deleting an account also deletes its dated snapshots and any holdings linked to it; deleting a liability also deletes its dated snapshots. This keeps removed items from silently contributing to historical net-worth totals.

## Holdings

The **Holdings** tab groups positions by **ticker**, with each account that holds the symbol nested underneath. The ticker row rolls up total shares and market value and shows the price, one-day change, and price basis once for the symbol rather than repeating them per account. The **Priced** column reads **Live** (green pill) while the US regular session is running, or `Close` / `Prev close` with the trading date outside it; hover for the exact quote time. Groups are ordered by value, largest first. Account rows keep their own **Edit** and delete controls, so a single position is still edited or removed individually.

**Select the ticker to set its expected annual return across every account at once.** Expected return is a property of the symbol, not of one account, so the dialog writes the rate to all positions in that ticker and lists the affected accounts and values before you save. The per-holding return field has been removed from the holding dialog; a newly added position inherits whatever rate the symbol already uses, so returns stay consistent by default.

Tickers group case-insensitively and ignore stray spacing, so entering `qqqm` joins an existing `QQQM` group. If positions in a group somehow disagree, the affected column reads **mixed**: mixed prices are then also shown per account row, and the return dialog opens on the largest position's rate — never on `0` — so a quick save cannot silently wipe a real assumption.

## Keyboard

Every edit dialog is keyboard driven. Opening one moves focus straight to its first field, so you can type without reaching for the mouse. **Enter** saves and **Esc** cancels, discarding the change; the dialog shows this hint at its foot. Enter respects field validation, so a dialog with a required field left blank stays open and flags the field rather than saving a broken record. Enter behaves normally inside a dropdown, where it picks the highlighted option. The import preview takes Esc to cancel but deliberately ignores Enter, so a stray keypress can never confirm an overwrite.

## Data safety

Data lives in your browser's `localStorage` under `nest-egg-data`, so **each browser and profile keeps its own separate copy**. If saved data cannot be read, the app now refuses to save over it: the demo dataset is displayed read-only, a red banner explains what happened, the unreadable text is copied to `nest-egg-data.corrupt`, and persistence stays disabled until the problem is resolved. Previously the demo fallback was written straight back over the stored data, destroying it.

With GitHub sync on, the private data repo is the shared copy and keeps every version in its commit history. Without sync, use **Export -> Download backup JSON** before large changes. Keep the CSVs in `data\` as a further source of truth: re-running **Import from data folder** rebuilds every account, liability, and dated balance from them. The `data/` folder is git-ignored so it is never published.

## Forecast

Open **Forecast** and choose a 1, 5, 10, 15, 20, or 30 year horizon. Assets and debts share **one chart**: asset accounts stack **above** the zero line and debts stack **below** it, so the distance between the two is your projected net worth. Both halves share a single scale, and the zero line sits wherever the asset and debt ranges meet, so the y-axis reads `max assets` / `$0` / `-max debt`.

Checkboxes sit **below** the chart in two groups, Accounts and Debts, and double as the legend — the colored dot beside each name matches its band in the chart and its row in the tables. Ticking and unticking rescales the axis, the headline figures, and the interest total, so you can isolate a single account or loan.

The header shows projected net worth at the chosen year, plus assets, remaining debt, and interest paid. A single breakdown table follows, with shared columns — Name, Current, Rate, Monthly, Year N — split into an **Assets** section and a **Debts** section so every figure lines up in one grid. Each section carries its own subtotal and the table closes with a net worth row. Debt rows show the remaining balance at the horizon with the payoff date beneath it. Unticked rows are dimmed and excluded from the chart and from every total.

Accounts and holdings have editable expected annual returns (default `0%` for older or newly imported data); a holding's return is set once per ticker and shared by every account that holds it. Cash-type/savings accounts compound their cash balance; property compounds at its expected annual appreciation, which may be negative; holdings in composed investment/retirement accounts compound at their holding return and include the configured cash component. Uncomposed imported account totals are treated as a single current-value series that grows at the account's own expected return (0% until you set one), so linked holdings cannot be counted twice.

Balances are stepped **month by month** rather than year by year, so contributions compound realistically.

### Monthly contributions

Every account except **property** has a *Monthly contribution* block in its edit dialog:

- **Amount added each month** — a flat dollar deposit applied at the end of every month.
- **Grow this contribution each year with inflation** — optional. When enabled, an *assumed annual inflation* field appears (defaults to `3%`) and the deposit steps up on each anniversary. Year 1 adds `amount`, year 2 adds `amount × (1 + rate)`, and so on.
- **Buy with this money** — where each deposit goes:
  - *Split across current holdings* (default) divides the deposit by each linked holding's share of today's market value; the dialog prints the exact split, e.g. `VTI 70%, BND 30%`. The mix is treated as a fixed target allocation, so it does not drift with performance.
  - *Hold as cash* accumulates the deposit as cash, compounding at the account's expected annual return.
  - *All into `TICKER`* sends every deposit into one linked holding.

An account with no linked holdings falls back to cash regardless of the setting. Contributions apply to uncomposed imported accounts too. The breakdown table's **Monthly** column shows, for example, `$500/mo +3%/yr for 20 yr`.

- **Stop contributing after (years)** — optional. Leave it blank (or `0`) to contribute for the whole horizon, which is the default and matches earlier versions. Set it to model retiring or otherwise stopping deposits: after that many years the account receives no new money but **keeps compounding** at its return. In the breakdown table this appears as a `for N yr` suffix on the Monthly column.

### Debt payoff

Every liability — mortgage, car loan, student loan, credit card, personal loan — is amortized and stacked **below the zero line** of the same chart. Depth is everything you still owe that year, and each debt visibly drops out of the stack as it is repaid.

Each liability has two extra fields:

- **Monthly principal & interest** — set it to project a payoff date, or leave it at 0 to hold the balance flat.
- **Extra principal each month** — optional overpayment applied straight against the balance.

> **Enter principal and interest only.** Most lenders bill a single **PITI** amount that also covers escrowed property tax and insurance. Escrow never reduces the loan balance, so including it would predict payoff years too early. Subtract the escrow portion before entering the payment — your lender's amortization statement lists the P&I split.

Given balance, APR, and P&I, the payoff month is exact. The table shows the horizon and calendar date (e.g. `16 yr 9 mo · Jun 2043`) and the payment including any extra principal. A liability with no payment set is simply held flat, with no payoff line and no banner — a debt you are not actively paying down is a normal thing to track, not a mistake to be nagged about. The one remaining red banner warns when a payment *is* set but cannot cover the first month's interest, since the balance would then never fall.

### Catching up a stale balance

Amortization drives the **Forecast tab only**. A mortgage balance is *not* silently reduced each month: the figure in your net worth is whatever you last entered or imported, because a real balance drifts from the schedule through extra payments, escrow changes, or a rate reset, and imported history is the authority.

To avoid a slowly rotting number, the Liabilities card offers the catch-up rather than applying it. When a liability has a monthly payment set and its balance is at least a month old, a line appears underneath it:

> Balance is from 2026-01-19. After 8 scheduled payments it should be about $183,008. **[Apply]**

**Apply** writes that balance, stamps it with today's date, and records today's dated snapshot, so the change enters your history like any other update. Nothing happens until you click it, and the prompt disappears once applied. It stays silent when no payment is set, when the balance is current, when the projected figure is within $1 of the stored one, and when the payment cannot cover the interest.

The "as of" date is the date you last changed the balance; for an imported liability it falls back to the newest dated row in its imported history. Editing only the rate or payment does not reset it.

Not modelled: adjustable rates, PMI removal, recasts, and irregular or skipped payments.
