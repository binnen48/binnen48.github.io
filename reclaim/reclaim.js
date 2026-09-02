/* Reclaim — empty token account CSV. No backend. */
(function () {
  "use strict";

  var RECEIVE = "CvoF6ga7Qiip4iT1EBVcwoHhKxwfKegLZyWvyqQSQk7L";
  var USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  var TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  var TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
  var BASE_ATOMS = 8000000; // 8.000000 USDC, 6 decimals
  var BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  var RPCS = [
    "https://api.mainnet-beta.solana.com",
    "https://solana-rpc.publicnode.com",
    "https://solana.drpc.org"
  ];

  var rpcIndex = 0;
  var state = {
    wallet: "",
    preview: null,
    pay: null,
    unlocked: false,
    seenSigs: {},
    pollTimer: null
  };

  var $ = function (id) { return document.getElementById(id); };

  function setStatus(el, msg, kind) {
    if (!el) return;
    el.textContent = msg || "";
    el.classList.remove("err", "ok");
    if (kind) el.classList.add(kind);
  }

  function isPubkey(s) {
    if (!s || s.length < 32 || s.length > 44) return false;
    for (var i = 0; i < s.length; i++) {
      if (BASE58.indexOf(s[i]) === -1) return false;
    }
    return true;
  }

  function shortAddr(a) {
    return a.slice(0, 4) + "…" + a.slice(-4);
  }

  function isoFromUnix(ts) {
    if (!ts) return "";
    try { return new Date(ts * 1000).toISOString(); } catch (e) { return ""; }
  }

  function fmtSol(lamports) {
    return (Number(lamports) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 9 });
  }

  function fmtUsdcAtoms(atoms) {
    var n = Number(atoms) / 1e6;
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  }

  async function rpc(method, params, opt) {
    opt = opt || {};
    var attempts = 0;
    var lastErr = null;
    while (attempts < RPCS.length * 2) {
      var url = RPCS[rpcIndex % RPCS.length];
      try {
        var res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params })
        });
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error("RPC " + res.status);
          rpcIndex++;
          attempts++;
          await sleep(280);
          continue;
        }
        var json = await res.json();
        if (json.error) {
          var msg = json.error.message || JSON.stringify(json.error);
          if (/rate|limit|too many|429/i.test(msg)) {
            lastErr = new Error(msg);
            rpcIndex++;
            attempts++;
            await sleep(280);
            continue;
          }
          throw new Error(msg);
        }
        return json.result;
      } catch (e) {
        lastErr = e;
        rpcIndex++;
        attempts++;
        await sleep(200);
      }
    }
    throw lastErr || new Error("Public Solana RPC is busy");
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function randomPay() {
    var buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    var suffix = (buf[0] % 9999) + 1; // 1..9999
    var atoms = BASE_ATOMS + suffix;
    var amount = (atoms / 1e6).toFixed(6); // 8.00XXXX
    return { suffix: String(suffix).padStart(4, "0"), atoms: atoms, amount: amount };
  }

  function payUrl(amount) {
    return "solana:" + RECEIVE + "?amount=" + amount + "&spl-token=" + USDC;
  }

  function loadPay(wallet) {
    try {
      var raw = sessionStorage.getItem("reclaim.pay." + wallet);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function savePay(wallet, pay) {
    try { sessionStorage.setItem("reclaim.pay." + wallet, JSON.stringify(pay)); } catch (e) {}
  }

  function loadUnlock(wallet, atoms) {
    try {
      return sessionStorage.getItem("reclaim.unlock." + wallet + "." + atoms) === "1";
    } catch (e) { return false; }
  }

  function saveUnlock(wallet, atoms) {
    try { sessionStorage.setItem("reclaim.unlock." + wallet + "." + atoms, "1"); } catch (e) {}
  }

  function isEmptyAmount(ta) {
    if (!ta) return false;
    if (ta.amount === "0" || ta.amount === 0) return true;
    if (ta.uiAmount === 0) return true;
    return false;
  }

  async function loadTokenRows(wallet) {
    var tokens = [];
    try {
      var classic = await rpc("getTokenAccountsByOwner", [
        wallet,
        { programId: TOKEN_PROGRAM },
        { encoding: "jsonParsed", commitment: "confirmed" }
      ]);
      tokens = tokens.concat(tokenRowsFromOwner(classic));
    } catch (e) {}
    try {
      var t22 = await rpc("getTokenAccountsByOwner", [
        wallet,
        { programId: TOKEN_2022 },
        { encoding: "jsonParsed", commitment: "confirmed" }
      ]);
      tokens = tokens.concat(tokenRowsFromOwner(t22));
    } catch (e) {}
    return tokens;
  }

  function emptyFrom(tokens) {
    var out = [];
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (!isEmptyAmount({ amount: t.amount, uiAmount: t.uiAmount })) continue;
      out.push(t);
    }
    return out;
  }

  async function previewWallet(wallet) {
    var tokens = await loadTokenRows(wallet);
    var empty = emptyFrom(tokens);
    var rentLamports = 0;
    for (var i = 0; i < empty.length; i++) rentLamports += Number(empty[i].lamports || 0);
    return {
      wallet: wallet,
      total: tokens.length,
      empty: empty,
      rentLamports: rentLamports
    };
  }

  function tokenRowsFromOwner(result) {
    var out = [];
    var rows = (result && result.value) || [];
    for (var i = 0; i < rows.length; i++) {
      var acc = rows[i];
      var info = acc.account && acc.account.data && acc.account.data.parsed && acc.account.data.parsed.info;
      if (!info) continue;
      var ta = info.tokenAmount || {};
      out.push({
        pubkey: acc.pubkey,
        mint: info.mint,
        owner: info.owner,
        decimals: ta.decimals,
        amount: ta.amount,
        uiAmount: ta.uiAmountString != null ? ta.uiAmountString : ta.uiAmount,
        program: acc.account.owner,
        lamports: acc.account.lamports
      });
    }
    return out;
  }

  async function fullExport(wallet) {
    var tokens = await loadTokenRows(wallet);
    var empty = emptyFrom(tokens);
    return { wallet: wallet, empty: empty, total: tokens.length };
  }

  function csvCell(v) {
    if (v == null) return "";
    var s = String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function buildCsv(data) {
    var lines = [];
    lines.push("# Reclaim empty token accounts");
    lines.push("# wallet," + data.wallet);
    lines.push("# generated," + new Date().toISOString());
    lines.push("# source,public Solana RPC (client-side)");
    lines.push("# empty_count," + data.empty.length);
    lines.push("# token_accounts," + data.total);
    lines.push("");
    lines.push(["token_account", "mint", "owner", "token_program", "lamports", "reclaimable_sol", "decimals", "amount"].join(","));
    for (var i = 0; i < data.empty.length; i++) {
      var t = data.empty[i];
      var lamports = Number(t.lamports || 0);
      lines.push([t.pubkey, t.mint, t.owner, t.program, lamports, lamports / 1e9, t.decimals, t.amount].map(csvCell).join(","));
    }
    return lines.join("\n") + "\n";
  }

  function filenameFor(wallet) {
    var d = new Date();
    var y = d.getUTCFullYear();
    var m = String(d.getUTCMonth() + 1).padStart(2, "0");
    var day = String(d.getUTCDate()).padStart(2, "0");
    return "reclaim-" + wallet.slice(0, 4) + wallet.slice(-4) + "-" + y + m + day + ".csv";
  }

  function downloadCsv(name, text) {
    var blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function txTouchesUsdcToReceive(tx, expectedAtoms) {
    if (!tx || !tx.meta) return false;
    var meta = tx.meta;
    var pre = meta.preTokenBalances || [];
    var post = meta.postTokenBalances || [];
    var preMap = {};
    for (var i = 0; i < pre.length; i++) {
      var p = pre[i];
      if (p.mint === USDC && p.owner === RECEIVE && p.uiTokenAmount) {
        preMap[p.accountIndex] = BigInt(p.uiTokenAmount.amount || "0");
      }
    }
    for (var j = 0; j < post.length; j++) {
      var b = post[j];
      if (b.mint !== USDC || b.owner !== RECEIVE || !b.uiTokenAmount) continue;
      var after = BigInt(b.uiTokenAmount.amount || "0");
      var before = preMap[b.accountIndex] != null ? preMap[b.accountIndex] : 0n;
      if (after - before === BigInt(expectedAtoms)) return true;
    }
    // Fallback: parsed SPL transfer / transferChecked to an account we later confirm via balances.
    function walk(ix) {
      if (!ix || !ix.parsed) return false;
      var t = ix.parsed.type;
      if (t !== "transfer" && t !== "transferChecked") return false;
      var info = ix.parsed.info || {};
      var atoms = null;
      if (info.tokenAmount && info.tokenAmount.amount != null) atoms = BigInt(info.tokenAmount.amount);
      else if (info.amount != null) atoms = BigInt(info.amount);
      if (atoms !== BigInt(expectedAtoms)) return false;
      if (info.mint && info.mint !== USDC) return false;
      // Destination is the ATA. Confirm owner via postTokenBalances.
      var dest = info.destination;
      if (!dest) return false;
      var keys = (((tx.transaction || {}).message) || {}).accountKeys || [];
      var destIndex = -1;
      for (var k = 0; k < keys.length; k++) {
        var key = typeof keys[k] === "string" ? keys[k] : keys[k].pubkey;
        if (key === dest) { destIndex = k; break; }
      }
      for (var n = 0; n < post.length; n++) {
        if (post[n].mint !== USDC) continue;
        if (post[n].owner === RECEIVE && (destIndex < 0 || post[n].accountIndex === destIndex)) return true;
      }
      return false;
    }
    var ixs = (((tx.transaction || {}).message) || {}).instructions || [];
    for (var x = 0; x < ixs.length; x++) if (walk(ixs[x])) return true;
    var inner = meta.innerInstructions || [];
    for (var g = 0; g < inner.length; g++) {
      var list = inner[g].instructions || [];
      for (var y = 0; y < list.length; y++) if (walk(list[y])) return true;
    }
    return false;
  }

  async function usdcAtas(owner) {
    try {
      var res = await rpc("getTokenAccountsByOwner", [
        owner,
        { mint: USDC },
        { encoding: "jsonParsed", commitment: "confirmed" }
      ]);
      return ((res && res.value) || []).map(function (r) { return r.pubkey; });
    } catch (e) {
      return [];
    }
  }

  async function checkPayment() {
    var pay = state.pay;
    if (!pay) return false;
    var cutoff = (pay.shownAt || 0) - 90;
    var addrs = [RECEIVE];
    var atas = await usdcAtas(RECEIVE);
    for (var i = 0; i < atas.length; i++) addrs.push(atas[i]);
    var sigs = [];
    var seen = {};
    for (var a = 0; a < addrs.length; a++) {
      var list = await rpc("getSignaturesForAddress", [
        addrs[a],
        { limit: 20, commitment: "confirmed" }
      ]) || [];
      for (var s = 0; s < list.length; s++) {
        var row = list[s];
        if (seen[row.signature]) continue;
        seen[row.signature] = true;
        if (row.blockTime && row.blockTime < cutoff) continue;
        sigs.push(row);
      }
    }
    for (var t = 0; t < sigs.length; t++) {
      var sig = sigs[t].signature;
      if (state.seenSigs[sig] === false) continue;
      if (state.seenSigs[sig] === true) return true;
      var tx = await rpc("getTransaction", [
        sig,
        { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }
      ]);
      var ok = txTouchesUsdcToReceive(tx, pay.atoms);
      state.seenSigs[sig] = ok;
      if (ok) return true;
      await sleep(80);
    }
    return false;
  }

  function renderPreview(p) {
    $("preview").hidden = false;
    $("acc-count").textContent = String(p.total);
    $("empty-count").textContent = String(p.empty.length);
    $("rent-sol").textContent = fmtSol(p.rentLamports) + " SOL";
    var tb = $("empty-body");
    tb.innerHTML = "";
    if (!p.empty.length) {
      var tr0 = document.createElement("tr");
      tr0.innerHTML = "<td colspan='3'>No empty token accounts. Nothing to reclaim.</td>";
      tb.appendChild(tr0);
      return;
    }
    var n = Math.min(p.empty.length, 8);
    for (var i = 0; i < n; i++) {
      var t = p.empty[i];
      var tr = document.createElement("tr");
      var td1 = document.createElement("td");
      td1.textContent = t.pubkey;
      var td2 = document.createElement("td");
      td2.textContent = t.mint;
      var td3 = document.createElement("td");
      td3.textContent = fmtSol(t.lamports || 0);
      tr.appendChild(td1);
      tr.appendChild(td2);
      tr.appendChild(td3);
      tb.appendChild(tr);
    }
  }

  function drawQr(url) {
    var wrap = $("qr-wrap");
    var canvas = $("qr");
    if (!wrap) return;
    var img = wrap.querySelector("img");
    if (!img) {
      img = document.createElement("img");
      img.alt = "Solana Pay QR";
      img.width = 168;
      img.height = 168;
      wrap.appendChild(img);
    }
    img.src = "https://api.qrserver.com/v1/create-qr-code/?size=168x168&data=" + encodeURIComponent(url);
    if (canvas) canvas.style.display = "none";
    wrap.hidden = false;
    img.onerror = function () { wrap.hidden = true; };
  }

  function showPaywall(wallet) {
    var pay = loadPay(wallet);
    if (!pay || !pay.amount || !pay.atoms || !pay.shownAt) {
      var gen = randomPay();
      pay = {
        amount: gen.amount,
        atoms: gen.atoms,
        suffix: gen.suffix,
        shownAt: Math.floor(Date.now() / 1000)
      };
      savePay(wallet, pay);
    }
    state.pay = pay;
    $("pay").hidden = false;
    $("pay-amount").textContent = pay.amount;
    $("pay-address").textContent = RECEIVE;
    $("solana-pay").href = payUrl(pay.amount);
    $("solana-pay").textContent = "Open Solana Pay";
    drawQr(payUrl(pay.amount));

    if (loadUnlock(wallet, pay.atoms)) {
      unlock();
    } else {
      startPoll();
    }
  }

  function unlock() {
    state.unlocked = true;
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
    $("unlock").hidden = false;
    $("pay-status").textContent = "Payment found. The empty-account CSV is unlocked.";
    $("pay-status").classList.remove("err");
    $("pay-status").classList.add("ok");
    if (state.wallet && state.pay) saveUnlock(state.wallet, state.pay.atoms);
  }

  function startPoll() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(function () {
      runCheck(true);
    }, 10000);
  }

  var checking = false;
  async function runCheck(silent) {
    if (checking || state.unlocked || !state.pay) return;
    checking = true;
    if (!silent) setStatus($("pay-status"), "Looking at the last payments on-chain…");
    try {
      var ok = await checkPayment();
      if (ok) unlock();
      else setStatus($("pay-status"), "No matching " + state.pay.amount + " USDC yet. Send the exact amount, then wait for a confirmation.");
    } catch (e) {
      setStatus($("pay-status"), "Could not check yet (" + (e.message || e) + "). Try again.", "err");
    }
    checking = false;
  }

  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
      if (btn) {
        var old = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(function () { btn.textContent = old; }, 1200);
      }
    } catch (e) {
      window.prompt("Copy this", text);
    }
  }

  async function onLookup(ev) {
    ev.preventDefault();
    var wallet = ($("wallet").value || "").trim();
    if (!isPubkey(wallet)) {
      setStatus($("lookup-status"), "That is not a Solana address. Paste a base58 pubkey.", "err");
      return;
    }
    state.wallet = wallet;
    state.unlocked = false;
    state.seenSigs = {};
    $("preview").hidden = true;
    $("pay").hidden = true;
    $("unlock").hidden = true;
    $("lookup-btn").disabled = true;
    setStatus($("lookup-status"), "Scanning token accounts…");
    try {
      var p = await previewWallet(wallet);
      state.preview = p;
      renderPreview(p);
      if (p.empty.length) {
        setStatus($("lookup-status"), "Found " + p.empty.length + " empty account" + (p.empty.length === 1 ? "" : "s") + ". Pay 8 USDC for the CSV.", "ok");
        showPaywall(wallet);
      } else {
        setStatus($("lookup-status"), "No empty token accounts on this wallet. Closing would reclaim 0 SOL.", "ok");
        $("pay").hidden = true;
        $("unlock").hidden = true;
      }
    } catch (e) {
      setStatus($("lookup-status"), "RPC failed: " + (e.message || e) + ". Try again in a few seconds.", "err");
    }
    $("lookup-btn").disabled = false;
  }

  async function onDownload() {
    if (!state.unlocked || !state.wallet) return;
    setStatus($("dl-status"), "Building CSV…");
    $("dl-btn").disabled = true;
    try {
      var data = await fullExport(state.wallet);
      var csv = buildCsv(data);
      downloadCsv(filenameFor(state.wallet), csv);
      setStatus($("dl-status"), "Downloaded " + filenameFor(state.wallet) + ".", "ok");
    } catch (e) {
      setStatus($("dl-status"), "Could not build the CSV: " + (e.message || e), "err");
    }
    $("dl-btn").disabled = false;
  }

  function ready() {
    $("lookup-form").addEventListener("submit", onLookup);
    $("check-btn").addEventListener("click", function () { runCheck(false); });
    $("dl-btn").addEventListener("click", onDownload);
    $("copy-amount").addEventListener("click", function () {
      if (state.pay) copyText(state.pay.amount, $("copy-amount"));
    });
    $("copy-address").addEventListener("click", function () {
      copyText(RECEIVE, $("copy-address"));
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();
