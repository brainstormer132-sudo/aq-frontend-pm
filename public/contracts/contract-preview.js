/**
 * Simple contract preview - the pure part.
 *
 * Builds a plain data model of what a vendor contract will say, from the
 * values sitting in the Add/Edit subtask form. No DOM, no fetch, no dates
 * of its own: everything comes in as an argument so the whole thing is
 * testable with `node tests/cpv.test.mjs`.
 *
 * What this is NOT: the real contract. The wording, the logo and the
 * layout live in the DOCX template on the backend, and only the backend
 * can render those. This model is the field set the template will be
 * filled with, arranged in the order the document reads, plus an honest
 * list of what is going to print blank. That is the question the preview
 * button is actually answering - "did I miss anything" - and it can be
 * answered here without a round trip and without inventing legal text.
 *
 * Loaded twice over: as a plain <script> in the contract app (it hangs
 * itself on window.AQContractPreview) and as a CommonJS module in the
 * test suite. No build step either way.
 */

(function (root) {
  "use strict";

  var MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  function text(value) {
    return String(value === null || value === undefined ? "" : value).trim();
  }

  function isBlank(value) {
    return text(value) === "";
  }

  /**
   * Money, built by hand rather than with toLocaleString.
   *
   * toLocaleString reads the runtime's ICU data, so the same number prints
   * differently on the server, in a test, and in a browser with a different
   * locale - which is how "9,000" and "9000" end up in the same report.
   * Returns "" for anything that is not a number, so the caller can flag it
   * as missing rather than printing NaN into a contract.
   */
  function moneyText(value) {
    var raw = text(value).replace(/,/g, "");
    if (raw === "") return "";
    var n = Number(raw);
    if (!isFinite(n)) return "";
    var negative = n < 0;
    var fixed = Math.abs(n).toFixed(2);
    var parts = fixed.split(".");
    var digits = parts[0];
    var out = "";
    for (var i = 0; i < digits.length; i++) {
      if (i > 0 && (digits.length - i) % 3 === 0) out += ",";
      out += digits.charAt(i);
    }
    return (negative ? "-" : "") + out + "." + parts[1];
  }

  /** "2026-09-30" or an ISO timestamp -> "30 Sep 2026". Anything else is
   *  passed through untouched: a date we cannot parse is still a date the
   *  user typed, and hiding it would be worse than showing it raw. */
  function dateText(value) {
    var raw = text(value);
    if (raw === "") return "";
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    if (!m) return raw;
    var month = Number(m[2]);
    if (month < 1 || month > 12) return raw;
    return String(Number(m[3])) + " " + MONTHS[month - 1] + " " + m[1];
  }

  function row(label, value, opts) {
    var options = opts || {};
    var shown = text(value);
    return {
      label: label,
      value: shown,
      missing: shown === "",
      required: options.required === true,
      bidi: options.bidi === true,
      mono: options.mono === true,
      hint: options.hint || "",
    };
  }

  /**
   * The preview model.
   *
   * input = {
   *   task:     { id, brand, duration, end_date, contract_type },
   *   template: { key, name },
   *   vendor:   { name, license_number, id_number, contact_name } | null,
   *   bank:     { bank_name, account_name, iban, account_number, swift_code } | null,
   *   line:     { platforms, handles, ad_type, ad_type_custom, qty, price, details },
   * }
   */
  function contractPreviewModel(input) {
    var data = input || {};
    var task = data.task || {};
    var template = data.template || {};
    var vendor = data.vendor || null;
    var bank = data.bank || null;
    var line = data.line || {};

    var templateName = text(template.name) || text(template.key);
    var identifier = text(vendor && vendor.license_number) || text(vendor && vendor.id_number);
    var identifierLabel = (vendor && !isBlank(vendor.license_number))
      ? "Licence number"
      : "ID number";

    var adType = text(line.ad_type);
    var isMultiService = adType.toLowerCase() === "multi service";
    var adTypeShown = isMultiService && !isBlank(line.ad_type_custom)
      ? adType + " - " + text(line.ad_type_custom)
      : adType;

    var durationRaw = text(task.duration);
    var durationRow = row("Contract length", durationRaw ? durationRaw + " days" : "", { required: true });
    if (durationRow.missing) {
      // Not a default. The template says "the transfer will be within
      // {{ duration }} days after the campaign ends", and docxtpl renders a
      // missing value as nothing at all - so a blank here prints a contract
      // with a blank payment deadline in it.
      durationRow.hint = "Set Contract Length on the task - the template prints this blank";
    }

    var sections = [
      {
        title: "Parties",
        rows: [
          row("First party", "AQ Creativity"),
          row("Second party", text(vendor && vendor.name), { required: true, bidi: true }),
          row(identifierLabel, identifier, { required: true, mono: true }),
          row("Contact name", text(vendor && vendor.contact_name), { bidi: true }),
        ],
      },
      {
        title: "Campaign",
        rows: [
          row("Brand", text(task.brand), { required: true, bidi: true }),
          row("Contract type", templateName, { required: true }),
          durationRow,
          row("End date", dateText(task.end_date)),
          row("Task", text(task.id), { mono: true }),
        ],
      },
      {
        title: "What is being bought",
        rows: [
          row("Ad type", adTypeShown, { required: true }),
          row("Quantity", text(line.qty)),
          row("Platform", text(line.platforms), { required: true }),
          row("Name on the platform", text(line.handles), { required: true, bidi: true }),
          row("Details", text(line.details), { bidi: true }),
        ],
      },
      {
        title: "Payment",
        rows: [
          row("Amount for this vendor", moneyText(line.price) ? "SAR " + moneyText(line.price) : "", { required: true, mono: true }),
          row("Payment terms", templateName ? "As per the " + templateName + " template" : ""),
          row("Bank", text(bank && bank.bank_name), { required: true }),
          row("Account name", text(bank && bank.account_name), { bidi: true }),
          row("IBAN", text(bank && bank.iban), { required: true, mono: true }),
          row("Account number", text(bank && bank.account_number), { mono: true }),
          row("SWIFT", text(bank && bank.swift_code), { mono: true }),
        ],
      },
    ];

    var missing = [];
    for (var s = 0; s < sections.length; s++) {
      var rows = sections[s].rows;
      for (var r = 0; r < rows.length; r++) {
        if (rows[r].required && rows[r].missing) missing.push(rows[r].label);
      }
    }

    // A zero price is not a blank field, but it is never a real contract
    // amount either, so it is called out in the same place.
    var priceNumber = Number(text(line.price).replace(/,/g, ""));
    if (text(line.price) !== "" && isFinite(priceNumber) && priceNumber === 0) {
      missing.push("Amount for this vendor is 0.00");
    }
    if (isMultiService && isBlank(line.ad_type_custom)) {
      missing.push("Multi-service text");
    }

    return {
      title: "Advertising services agreement",
      subtitle: templateName ? templateName + " template" : "No contract type set on the task",
      reference: "Contract number is assigned when you generate",
      sections: sections,
      missing: missing,
      missingSentence: missingSentence(missing),
    };
  }

  /** One line, folded, rather than a list of near-identical warnings. */
  function missingSentence(missing) {
    if (!missing || missing.length === 0) {
      return "Every field the contract needs is filled in.";
    }
    var shown = missing.slice(0, 5).join(", ");
    var rest = missing.length - 5;
    return missing.length === 1
      ? "1 field will print blank: " + shown + "."
      : missing.length + " fields will print blank: " + shown
        + (rest > 0 ? ", and " + rest + " more." : ".");
  }

  /* --- The document view -------------------------------------------
   *
   * contract-template-ar.js carries the template's own text with the
   * {{ placeholders }} still in it. These two turn the form into the
   * values those placeholders want, and then into blocks of segments -
   * plain text and filled fields - that the renderer can draw without
   * knowing anything about contracts.
   */

  /** "2026-09-08" -> "08/09/2026", the way the Arabic document writes it. */
  function slashDate(value) {
    var raw = text(value);
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    return m ? m[3] + "/" + m[2] + "/" + m[1] : raw;
  }

  /**
   * The placeholder values, keyed exactly as the DOCX names them.
   *
   * `pending` marks the ones the backend fills at generation time - the
   * contract number and the hijri date. They are not gaps, and colouring
   * them like gaps would cry wolf on every preview.
   */
  function contractFieldValues(input, options) {
    var data = input || {};
    var opts = options || {};
    var strings = opts.strings || {};
    var task = data.task || {};
    var vendor = data.vendor || null;
    var bank = data.bank || null;
    var line = data.line || {};

    var identifier = text(vendor && vendor.license_number) || text(vendor && vendor.id_number);
    var adType = text(line.ad_type);
    var adTypeShown = adType.toLowerCase() === "multi service" && !isBlank(line.ad_type_custom)
      ? adType + " - " + text(line.ad_type_custom)
      : adType;
    var amount = moneyText(line.price);

    return {
      id: { pending: true },
      date: { value: slashDate(opts.today) },
      day: { pending: true },
      license_name: { value: text(vendor && vendor.name), required: true },
      license_number: { value: identifier, required: true },
      brand_name: { value: text(task.brand), required: true },
      name_2: { value: text(vendor && vendor.name), required: true },
      platform_smart: { value: text(line.platforms), required: true },
      channel_name: { value: text(line.handles), required: true },
      ad_types: { value: adTypeShown, required: true },
      Amount_full: { value: amount ? amount + " " + (strings.riyal || "SAR") : "", required: true },
      duration: { value: text(task.duration), required: true },
      bank_name: { value: text(bank && bank.bank_name), required: true },
      account_name: { value: text(bank && bank.account_name), required: true },
      account_number: { value: text(bank && bank.account_number), required: true },
      iban: { value: text(bank && bank.iban), required: true },
    };
  }

  function splitSegments(raw, values, strings) {
    var source = String(raw === null || raw === undefined ? "" : raw);
    var segs = [];
    var re = /\{\{\s*(\w+)\s*\}\}/g;
    var last = 0;
    var m;
    while ((m = re.exec(source)) !== null) {
      if (m.index > last) segs.push({ t: "text", v: source.slice(last, m.index) });
      var key = m[1];
      var field = values[key] || {};
      var value = text(field.value);
      segs.push({
        t: "field",
        key: key,
        v: value || (field.pending ? (strings.pending || "") : (strings.missing || "")),
        missing: !field.pending && value === "",
        pending: field.pending === true && value === "",
      });
      last = re.lastIndex;
    }
    if (last < source.length) segs.push({ t: "text", v: source.slice(last) });
    return segs;
  }

  function contractDocument(template, values) {
    var tpl = template || {};
    var strings = tpl.strings || {};
    var fields = values || {};
    var blocks = (tpl.blocks || []).map(function (block) {
      if (block.t === "table") {
        return {
          t: "table",
          rows: (block.rows || []).map(function (cells) {
            return cells.map(function (cell) { return splitSegments(cell, fields, strings); });
          }),
        };
      }
      if (block.t === "sig") {
        return {
          t: "sig",
          right: splitSegments(block.right, fields, strings),
          left: splitSegments(block.left, fields, strings),
        };
      }
      return { t: block.t, segs: splitSegments(block.v, fields, strings) };
    });
    return { key: tpl.key || "", label: tpl.label || "", blocks: blocks };
  }

  var api = {
    contractPreviewModel: contractPreviewModel,
    contractFieldValues: contractFieldValues,
    contractDocument: contractDocument,
    missingSentence: missingSentence,
    moneyText: moneyText,
    dateText: dateText,
    slashDate: slashDate,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.AQContractPreview = api;
})(typeof window !== "undefined" ? window : null);
