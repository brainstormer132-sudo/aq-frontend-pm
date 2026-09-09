/**
 * The contract app's decisions, as pure functions.
 *
 * app.js is one 5,900-line script of DOM and fetch, which means the rules
 * buried in it - may this request be sent again, is this vendor the one
 * you typed - can only be checked by clicking. These four can be checked
 * by `node tests/cra.test.mjs` instead, and app.js calls them.
 *
 * Loaded as a plain <script> in the browser (it hangs itself on
 * window.AQContractRules) and as a CommonJS module in the suite. No build
 * step either way.
 */

(function (root) {
  "use strict";

  function text(value) {
    return String(value === null || value === undefined ? "" : value).trim();
  }

  /**
   * May this request be re-sent automatically after a network error?
   *
   * Only if sending it twice is the same as sending it once. A dropped
   * connection tells you nothing about whether the server acted: a POST
   * that times out in the gateway has very often already been written, so
   * re-sending it is how twenty subtasks become forty signed contracts.
   * GET and HEAD are safe; everything else has to be re-sent by a person
   * who can see what happened.
   */
  function isSafeToAutoRetry(options) {
    var method = text((options || {}).method || "GET").toUpperCase();
    return method === "GET" || method === "HEAD";
  }

  /**
   * Is this failure the kind that might succeed on its own in a moment?
   *
   * The free hosting tier sleeps, and LibreOffice conversions outlast the
   * gateway - both look like this. A 4xx or a validation message does not,
   * and retrying those only wastes the user's time.
   */
  function isTransientError(message) {
    return /failed to fetch|networkerror|network error|timeout|timed out|502|503|504/i
      .test(text(message));
  }

  /**
   * The number a vendor is known by: the media licence if they have one,
   * otherwise the ID.
   *
   * Categories with requires_license false - models, rentals, events,
   * logistics, locations - never have a licence, and the subtask form
   * keys the whole booking on this value.
   */
  function vendorIdentifier(vendor) {
    if (!vendor) return "";
    return text(vendor.license_number) || text(vendor.id_number);
  }

  /**
   * Find a vendor by whichever number was typed or picked.
   *
   * Matching only license_number is what made ID-only vendors findable in
   * the picker and impossible to select: the row appeared, the click wrote
   * an empty string, and the form said "No vendor found for this license."
   */
  function findVendorByIdentifier(vendors, value) {
    var wanted = text(value).toLowerCase();
    if (!wanted) return null;
    var list = Array.isArray(vendors) ? vendors : [];
    for (var i = 0; i < list.length; i++) {
      var vendor = list[i];
      if (text(vendor && vendor.license_number).toLowerCase() === wanted) return vendor;
    }
    // Licence first, ID second: if a licence and somebody else's ID collide,
    // the licence holder is the one the contract is for.
    for (var j = 0; j < list.length; j++) {
      var other = list[j];
      if (text(other && other.id_number).toLowerCase() === wanted) return other;
    }
    return null;
  }

  /**
   * What to call a vendor category on screen.
   *
   * The lookup table's column is `label`; one dropdown read `name` and
   * rendered a list of blank options for a field that is mandatory.
   */
  function categoryLabel(category) {
    if (!category) return "";
    return text(category.label) || text(category.name) || text(category.key);
  }

  var api = {
    isSafeToAutoRetry: isSafeToAutoRetry,
    isTransientError: isTransientError,
    vendorIdentifier: vendorIdentifier,
    findVendorByIdentifier: findVendorByIdentifier,
    categoryLabel: categoryLabel,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.AQContractRules = api;
})(typeof window !== "undefined" ? window : null);
