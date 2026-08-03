# Cense

*Know where it went.*
**An RNE Holdings Product**

A budgeting app built from the Google Sheets template in `Budget .xlsx`.
Percentage buckets, recurring charges on autopilot, and the four spending types
from the original sheet — including **Bullshit**, which was the best idea in it
and is now the product's whole personality.

## Running it

Double-click **`landing.html`** for the marketing page, or **`index.html`** to
go straight into the app. Both work offline with no install, no account and no
server.

If a browser refuses to run it from a file, start the bundled server instead:

```
powershell -ExecutionPolicy Bypass -File serve.ps1
```

then open <http://localhost:8123>.

## Installing it as an app

Cense is a PWA, so it installs on Windows, Android and iOS without a store, a
build step or a toolchain. It needs to be served over `http://localhost` or
HTTPS — service workers do not run from `file://`, so the plain double-click
route stays a normal browser tab.

- **Windows** — run `serve.ps1`, open <http://localhost:8123> in Edge or Chrome,
  then use the install icon in the address bar (or ⋯ → Apps → Install). You get
  a Start Menu entry, its own window with no address bar, and the `¢` icon.
- **Phone** — the folder has to be reachable from the phone, so host it (GitHub
  Pages is free and fits: push the folder, enable Pages). Then **Add to Home
  Screen** in Safari or Chrome.

Once installed it runs with no network at all — the service worker keeps a copy
of the app itself. It caches Cense's own files only; it never touches a budget,
which still lives in that device's own storage.

**Your budget does not follow the install.** Storage is per-origin, so the app
installed from `localhost:8123` and the same files double-clicked from disk are
two separate budgets, and your phone is a third. Pick one as the real one and
move backups between them by hand.

If you change `index.html`, `styles.css` or `app.js`, **bump `CACHE` in
`sw.js`** — otherwise an installed copy keeps serving the version it cached.

## Trying it before you type anything in

Cense is easier to judge full than empty. **Settings → Load the sample
household**, or open `index.html?demo=1` — the landing page links straight to it.

It loads a made-up household built relative to today, so it is never stale: a
month that overspent Needs and is carrying the difference in, a Christmas fund
that is going to be short, a card with a rate on it, and an account that dips
below zero four days before payday while still ending the month up.

**It cannot cost you anything.** Your real budget is moved aside to a separate
key while the demo runs and comes straight back when you clear it — edit,
delete and reset as roughly as you like. A backup exported during the demo is
named `cense-DEMO-…` so it can never be mistaken for the real thing.

## Bringing in your own numbers

Cense reads its own backup format, so anything you can shape into that JSON can
be restored in one go: **Settings → Restore backup**.

Otherwise start from **Settings** — put in what you make, adjust the buckets,
then add your recurring charges under **Regulars**. Bank CSVs import from
**Spending → Import CSV**.

## The screens

| Screen | What it is |
|---|---|
| **Dashboard** | Each bucket's allocation vs. what you actually spent, for one month |
| **Spending** | The monthly log. Add by hand, or import a bank CSV |
| **Regulars** | Charges you know are coming. Flip **Auto** on and they post themselves |
| **Funds** | Money set aside for things that aren't monthly |
| **Debts** | What you owe, what it costs, and how fast it's going |
| **Settings** | Income, buckets, carryover, cash-flow, backup and restore |

## Funds

Christmas, the next set of tyres, the insurance renewal. These are not
surprises — they are bills you haven't started paying yet, and they are the
single most common way a month gets wrecked.

Give a fund a **target** and a **cycle** (`$850`, `every 12 months`) and Cense
works out the monthly figure. One button turns that into a regular that pays
into it. When the bill lands, tag the charge to the fund in **Spending** and it
draws the balance down.

The balance is never stored — it is what has been paid in minus what has been
taken out, so it cannot drift away from the charges that justify it. Spend more
than the fund holds and it says so, because that is the exact thing funds exist
to make visible.

Set a **needed in** month and Cense checks the arithmetic: starting a $850
Christmas fund in July gets you to $354 by December, and it will tell you so
rather than letting you find out in December.

## Debts

A debt has a balance, and optionally an interest rate.

Point a regular at a debt (the **Toward** column) and every payment comes off
the balance — so a year of payments actually shows as a year of progress
instead of the same number it started at.

Add the rate and Cense tells you what waiting costs: how long it takes at the
current payment, how much interest you hand over on the way, and what another
$50 a month would save. If the payment is smaller than the monthly interest it
says that outright — *"at $250 a month this never gets paid off"* — which is the
most useful sentence on the screen and the one nobody is ever shown.

## Carrying over

On by default. Overspend a bucket and next month starts owing itself the
difference; underspend and it starts with something extra. Off, and every month
starts from zero and nothing is ever learned. Saving buckets never carry.

## Running out before payday

Overspending and running out of money are different failures. A month can close
in the black and still bounce twice, because the rent landed before the paycheck
did.

Give Cense the balance in your account and which day you get paid, and it walks
the month day by day — using the days your regulars are due — to find the point
where the account dips below zero. Leave the balance at 0 and this stays off.

## Spending vs. saving

Every bucket is one of two types, set in **Settings**:

- **Spending** — money that is gone. It counts toward *Money out*.
- **Saving** — money you still have, just somewhere else. It gets its own
  *Saved* tile, stays out of *Money out*, and stays out of the "Where it went"
  chart, because it did not go anywhere.

Both still come off *Still yours*, which is income minus everything that has
moved. A month where you save aggressively should look different from one where
you spent the same amount on takeaway, and this is the difference.

Charges can also be tagged **Toward** a fund or a debt, which is what makes
those two screens add up.

## How Regulars work

A regular is a line item with an amount, a day of the month (1–31), and an
**Auto** switch. A charge dated the 31st lands on the last day of a short month
without the plan forgetting it was the 31st.

- **Auto off** — it's a plan on paper. It counts toward what the bucket has
  committed, but nothing is recorded until you log the charge yourself. Use this
  for anything that moves around, like groceries or gas.
- **Auto on** — Cense posts it as a real charge, dated to its day, the first
  time you open the app in a new month. A banner tells you what it did, with an
  **Undo**.

Four rules keep this from making a mess of your history:

1. **Only the live month is ever posted to.** Scrolling back to March will never
   fabricate a March you didn't log, and scrolling forward won't invent a future.
2. **Each posting is recorded per item**, so deleting a posted charge doesn't
   make it reappear on the next screen refresh.
3. **Undo means "not this month"**, not "pretend it never ran" — so undoing
   doesn't leave the app free to post them straight back.
4. **Deleting a regular and re-creating it doesn't double the charge.** The new
   line item is a different row, but Cense also checks what the month already
   has in it before posting anything.

If the month rolls over while the app is open, Cense follows the money: it moves
you to the new month so the banner and its **Undo** are actually in front of you,
rather than posting real charges onto a screen you aren't looking at.

## Auto-categorization

File a charge once and Cense remembers it. It also handles bank noise: after you
categorize `DOMINOS PIZZA 4471 AUSTIN`, a later `DOMINOS PIZZA 9982 ROUND ROCK`
is recognized, because it remembers the leading words rather than the whole
string with its store number attached.

## CSV import

Reads a statement exported from your bank. It guesses which columns hold the
date, description and amount, skips deposits and credits, and proposes a bucket
per row. Nothing is uploaded — the file is parsed inside the page.

**Charges you already have are skipped**, so re-importing the same statement —
or two exports whose date ranges overlap — doesn't double your month. The check
counts rather than just matches, so if you really did buy the same coffee twice
on the same day, the second one still comes in.

Anything deleted by hand can be put back from the **Undo** bar, which sticks
around until you dismiss it rather than vanishing with a toast.

## Sharing it

Send the folder, or host these files anywhere static. Each person's data lives
only in their own browser — nobody sees anyone else's, and no server holds
anyone's financial history.

The trade-off: data is per-browser and per-device. It does not follow you from
laptop to phone. **Export a backup from Settings regularly** — clearing your
browser data will erase it.

## Why this exists

Cense started as a port of a Google Sheets budget, and the port found six
arithmetic bugs in the original — the kind every hand-built spreadsheet grows:

1. A bucket percentage hardcoded into a formula, ignoring the cell meant to
   control it.
2. The bucket percentages summed to 105%.
3. A `=SUM()` with no arguments, so a category total read `#N/A`.
4. A total that summed a range stopping short of the last rows, quietly
   under-reporting the month.
5. Two neighbouring totals summing different ranges.
6. Category totals written as hand-typed cell chains rather than ranges, so new
   rows went uncounted — and one of them reached into the wrong column.

None of these announce themselves. A spreadsheet that is wrong still adds up to
something, and shows you that something with total confidence. That is the
argument for the app.

## Design notes

Chart and bucket colors come from a validated categorical palette (fixed slot
order, colorblind-safe adjacent pairs). Brand chrome deliberately introduces no
additional hue, so a brand color can never be mistaken for a data series. Every
series is named and valued in the legend, so identity never rests on color alone.

Below 600px the editable tables stop being tables. Six or seven columns of
inputs will not fit a phone however they are shaved, and logging a charge is the
one thing people do on a phone — so each row becomes a labelled card and the
column headers are moved off-screen for screen readers only. Read-only tables
(the CSV preview) keep scrolling instead, because stacking them would push the
modal's buttons out of reach. Nothing about the desktop layout changes.

On **Spending** a phone row goes one step further and starts collapsed: a single
line showing the charge and the amount, both still editable, with a **⌄** to
open the rest. Six editable fields per charge is right when you are correcting
one and absurd when you are scanning fifty — a month of spending is about three
screens closed and would be nineteen open. Delete is only offered on an open
row, so the destructive control is never one stray thumb away while scrolling.

## Files

| File | |
|---|---|
| `landing.html` | Marketing page |
| `index.html` | The app |
| `styles.css` | Styling and design tokens, light and dark |
| `app.js` | All application logic, including the sample household |
| `my-budget-data.json` | Your spreadsheet's contents, ready to import |
| `manifest.webmanifest` | Makes it installable as an app |
| `sw.js` | Offline cache. Bump `CACHE` when you change a file |
| `icon-*.png`, `favicon-32.png` | App icons |
| `serve.ps1` | Local server — needed to install, optional otherwise |
| `Budget .xlsx` | The original spreadsheet, untouched |

## Naming

`Cense` — cents plus sense, and the `¢` makes a free logo. The one real risk is
that it's a homophone of "sense", so someone hearing it spoken won't find it by
searching. Alternatives considered: **Fritter** (as in frittering money away —
sits well beside the Bullshit bucket) and **Nickel** (concrete, easy to spell).
Renaming is a find-and-replace across `index.html`, `landing.html` and the
`BRAND`-facing copy in `app.js`.
