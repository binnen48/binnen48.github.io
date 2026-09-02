/* Slip — client-side Solana wallet CSV. No backend. */
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
      var raw = sessionStorage.getItem("slip.pay." + wallet);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function savePay(wallet, pay) {
    try { sessionStorage.setItem("slip.pay." + wallet, JSON.stringify(pay)); } catch (e) {}
  }

  function loadUnlock(wallet, atoms) {
    try {
      return sessionStorage.getItem("slip.unlock." + wallet + "." + atoms) === "1";
    } catch (e) { return false; }
  }

  function saveUnlock(wallet, atoms) {
    try { sessionStorage.setItem("slip.unlock." + wallet + "." + atoms, "1"); } catch (e) {}
  }

  async function previewWallet(wallet) {
    var bal = await rpc("getBalance", [wallet, { commitment: "confirmed" }]);
    var lamports = (bal && bal.value != null) ? bal.value : 0;
    var usdcAtoms = 0;
    var usdcAccounts = 0;
    try {
      var usdc = await rpc("getTokenAccountsByOwner", [
        wallet,
        { mint: USDC },
        { encoding: "jsonParsed", commitment: "confirmed" }
      ]);
      var rows = (usdc && usdc.value) || [];
      usdcAccounts = rows.length;
      for (var i = 0; i < rows.length; i++) {
        var ta = rows[i].account.data.parsed.info.tokenAmount;
        usdcAtoms += Number(ta.amount || 0);
      }
    } catch (e) {
      /* USDC lookup failed — still show SOL */
    }
    var sigs = [];
    try {
      sigs = await rpc("getSignaturesForAddress", [wallet, { limit: 10 }]) || [];
    } catch (e) {
      sigs = [];
    }
    return {
      wallet: wallet,
      lamports: lamports,
      usdcAtoms: usdcAtoms,
      usdcAccounts: usdcAccounts,
      sigs: sigs
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
        program: acc.account.owner
      });
    }
    return out;
  }

  async function fullExport(wallet) {
    var bal = await rpc("getBalance", [wallet, { commitment: "confirmed" }]);
    var lamports = (bal && bal.value != null) ? bal.value : 0;
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
    var sigs = [];
    try {
      sigs = await rpc("getSignaturesForAddress", [wallet, { limit: 50 }]) || [];
    } catch (e) {}
    return { wallet: wallet, lamports: lamports, tokens: tokens, sigs: sigs };
  }

  function csvCell(v) {
    if (v == null) return "";
    var s = String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function symbolForMint(mint) {
    if (mint === USDC) return "USDC";
    if (mint === "native-SOL") return "SOL";
    return "";
  }

  function buildCsv(data) {
    var lines = [];
    lines.push("# Slip export");
    lines.push("# wallet," + data.wallet);
    lines.push("# generated," + new Date().toISOString());
    lines.push("# source,public Solana RPC (client-side)");
    lines.push("");
    lines.push(["kind", "account", "mint", "symbol", "decimals", "amount", "ui_amount"].join(","));
    lines.push(["SOL", data.wallet, "native-SOL", "SOL", "9", String(data.lamports), String(data.lamports / 1e9)].map(csvCell).join(","));
    for (var i = 0; i < data.tokens.length; i++) {
      var t = data.tokens[i];
      lines.push(["SPL", t.pubkey, t.mint, symbolForMint(t.mint), t.decimals, t.amount, t.uiAmount].map(csvCell).join(","));
    }
    lines.push("");
    lines.push(["kind", "signature", "slot", "block_time", "iso_time", "err"].join(","));
    for (var j = 0; j < data.sigs.length; j++) {
      var s = data.sigs[j];
      var err = s.err ? JSON.stringify(s.err) : "";
      lines.push(["SIG", s.signature, s.slot, s.blockTime || "", isoFromUnix(s.blockTime), err].map(csvCell).join(","));
    }
    return lines.join("\n") + "\n";
  }

  function filenameFor(wallet) {
    var d = new Date();
    var y = d.getUTCFullYear();
    var m = String(d.getUTCMonth() + 1).padStart(2, "0");
    var day = String(d.getUTCDate()).padStart(2, "0");
    return "slip-" + wallet.slice(0, 4) + wallet.slice(-4) + "-" + y + m + day + ".csv";
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
    $("sol-bal").textContent = fmtSol(p.lamports) + " SOL";
    $("usdc-bal").textContent = p.usdcAccounts
      ? fmtUsdcAtoms(p.usdcAtoms) + " USDC"
      : "No USDC account";
    var tb = $("sig-body");
    tb.innerHTML = "";
    if (!p.sigs.length) {
      var tr0 = document.createElement("tr");
      tr0.innerHTML = "<td colspan='3'>No signatures on this address.</td>";
      tb.appendChild(tr0);
      return;
    }
    for (var i = 0; i < p.sigs.length; i++) {
      var s = p.sigs[i];
      var tr = document.createElement("tr");
      var td1 = document.createElement("td");
      td1.textContent = s.signature;
      var td2 = document.createElement("td");
      td2.textContent = s.slot != null ? String(s.slot) : "";
      var td3 = document.createElement("td");
      td3.className = "time";
      td3.textContent = s.blockTime ? isoFromUnix(s.blockTime).replace("T", " ").replace("Z", " UTC") : "";
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
    $("pay-status").textContent = "Payment found. Download is unlocked.";
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
    setStatus($("lookup-status"), "Asking public RPC…");
    try {
      var p = await previewWallet(wallet);
      state.preview = p;
      renderPreview(p);
      setStatus($("lookup-status"), "Preview from public RPC. Pay 8 USDC to download the full CSV.", "ok");
      showPaywall(wallet);
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
