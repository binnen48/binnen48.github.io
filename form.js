(function () {
  var form = document.getElementById("intake");
  if (!form) return;

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var get = function (name) {
      var el = form.elements[name];
      if (!el) return "";
      if (el.type === "checkbox") return el.checked ? "yes" : "no";
      return String(el.value || "").trim();
    };

    var isNl = (document.documentElement.lang || "").toLowerCase().indexOf("nl") === 0;
    var offer = (form.getAttribute("data-offer") || "custom").toLowerCase();
    var thanks = form.getAttribute("data-thanks") || (isNl ? "bedankt.html" : "thanks.html");

    var name = get("bedrijfsnaam") || get("business") || get("name") || get("project");
    var city = get("stad") || get("city");
    var whatsapp = get("whatsapp");
    var email = get("email");
    var contact = whatsapp || get("contact") || email;
    var description = get("omschrijving") || get("description") || get("note");
    var social = get("social");
    var hosting = get("hosting");

    var subject, body;

    if (offer === "kit") {
      subject = "Kit order" + (name ? " — " + name : "");
      body = [
        "Kit order",
        "",
        "Name: " + (name || "—"),
        "Email: " + (email || "—"),
        "WhatsApp: " + (whatsapp || "—"),
        "Note: " + (description || "—")
      ].join("\n");
    } else if (offer === "operator") {
      subject = "Operator request" + (name ? " — " + name : "");
      body = [
        "Operator request",
        "",
        "Name / project: " + (name || "—"),
        "Contact: " + (contact || "—"),
        "What they do: " + (description || "—"),
        "Hosting: " + (hosting || "—")
      ].join("\n");
    } else if (isNl) {
      subject = "Aanvraag Binnen48 — " + name + " (" + city + ")";
      body = [
        "Aanvraag Binnen48",
        "",
        "Bedrijfsnaam: " + name,
        "Stad: " + city,
        "WhatsApp: " + contact,
        "Omschrijving: " + description,
        "Instagram/Facebook: " + (social || "—")
      ].join("\n");
    } else {
      subject = "Binnen48 request — " + name + " (" + city + ")";
      body = [
        "Binnen48 request",
        "",
        "Business: " + name,
        "City: " + city,
        "WhatsApp / email: " + contact,
        "Description: " + description,
        "Instagram / Facebook: " + (social || "—")
      ].join("\n");
    }

    var mailto =
      "mailto:binnen48@agentmail.to" +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(body);

    var a = document.createElement("a");
    a.href = mailto;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();

    window.setTimeout(function () {
      window.location.href = thanks;
    }, 500);
  });
})();
