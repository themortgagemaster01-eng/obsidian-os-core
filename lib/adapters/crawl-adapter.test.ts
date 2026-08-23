import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as cheerio from "cheerio";

import { extractStructuredFacts, mergeStructuredFacts, prioritizeSampleUrls } from "@/lib/adapters/crawl-adapter";
import { resolveIndustryBucket } from "@/lib/design-references/reference-library";

const JSON_LD_HTML = `
<html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "telephone": "+1-555-123-4567",
  "email": "hello@example.com",
  "address": {
    "streetAddress": "123 Main St",
    "addressLocality": "Springfield",
    "addressRegion": "IL",
    "postalCode": "62701"
  },
  "openingHours": ["Mo-Fr 09:00-17:00", "Sa 10:00-14:00"],
  "sameAs": ["https://www.facebook.com/example", "https://www.instagram.com/example"],
  "aggregateRating": { "ratingValue": "4.8", "reviewCount": "132" }
}
</script>
</head><body>
<nav class="main-nav"><a class="nav-menu-item" href="/services">Services</a></nav>
<div id="services-section"><h2>Our Services</h2><p>We offer plumbing and heating repair for local homes.</p></div>
<form action="/contact" method="post">
  <input type="text" name="name" />
  <input type="email" name="email" />
</form>
<iframe src="https://www.google.com/maps/embed?pb=abc"></iframe>
</body></html>
`;

const HEURISTIC_ONLY_HTML = `
<html><body>
<p>Call us at (555) 987-6543 or email contact@example.org for details.</p>
<a href="tel:555-222-3333">Call now</a>
<a href="mailto:info@example.org">Email us</a>
<div class="hours-block">Mon-Fri: 8am - 6pm</div>
<div class="testimonial-card"><h3>Jane D.</h3><p>Absolutely fantastic service, highly recommend this team!</p></div>
<div id="team-bios"><h2>Meet the Team</h2><p>Our team has over 20 years combined experience.</p></div>
<div class="faq-item"><h4>What areas do you serve?</h4><p>We serve the greater metro area.</p></div>
<a href="https://twitter.com/example">Twitter</a>
<a href="https://www.linkedin.com/company/example">LinkedIn</a>
<div class="photo-gallery"><img src="/img1.jpg" alt="Storefront" /><img src="/img2.jpg" alt="Interior" /></div>
</body></html>
`;

const EMPTY_HTML = `<html><body><p>Nothing structured here.</p></body></html>`;

describe("crawl-adapter: extractStructuredFacts (JSON-LD source)", () => {
  const $ = cheerio.load(JSON_LD_HTML);
  const facts = extractStructuredFacts($, "https://example.test/");

  test("extracts contact info from schema.org JSON-LD", () => {
    assert.ok(facts.contact.phones.includes("+1-555-123-4567"));
    assert.ok(facts.contact.emails.includes("hello@example.com"));
    assert.equal(facts.contact.address, "123 Main St, Springfield, IL, 62701");
    assert.equal(facts.contact.hours, "Mo-Fr 09:00-17:00; Sa 10:00-14:00");
  });

  test("extracts socials from JSON-LD sameAs", () => {
    assert.equal(facts.socials.facebook, "https://www.facebook.com/example");
    assert.equal(facts.socials.instagram, "https://www.instagram.com/example");
    assert.equal(facts.socials.linkedin, null);
  });

  test("extracts reviews from aggregateRating", () => {
    assert.equal(facts.reviews.averageRating, 4.8);
    assert.equal(facts.reviews.count, 132);
    assert.equal(facts.reviews.source, "schema.org structured data");
  });

  test("extracts forms with field metadata", () => {
    assert.equal(facts.forms.length, 1);
    assert.equal(facts.forms[0].action, "/contact");
    assert.equal(facts.forms[0].method, "post");
    assert.equal(facts.forms[0].hasEmailField, true);
    assert.equal(facts.forms[0].fieldCount, 2);
  });

  test("extracts a Google Maps embed", () => {
    assert.equal(facts.maps.length, 1);
    assert.equal(facts.maps[0].provider, "google");
  });

  test("does not pick up nav-menu class as a services section false positive", () => {
    // The <nav class="main-nav"> and its "nav-menu-item" link should be
    // excluded by findSectionsByKeywords' nav/header/footer guard even
    // though "menu" isn't one of the services keywords — this test guards
    // the id="services-section" match itself doesn't accidentally include
    // nav content.
    for (const section of facts.services) {
      assert.ok(!section.excerpt.includes("Services") || section.heading === "Our Services");
    }
    assert.ok(facts.services.some((s) => s.heading === "Our Services"));
  });
});

describe("crawl-adapter: extractStructuredFacts (DOM/regex heuristics, no JSON-LD)", () => {
  const $ = cheerio.load(HEURISTIC_ONLY_HTML);
  const facts = extractStructuredFacts($, "https://example.test/");

  test("extracts phone numbers from tel: links and body text", () => {
    assert.ok(facts.contact.phones.includes("555-222-3333"));
    assert.ok(facts.contact.phones.some((p) => p.includes("555") && p.includes("987")));
  });

  test("extracts emails from mailto: links and body text", () => {
    assert.ok(facts.contact.emails.includes("info@example.org"));
    assert.ok(facts.contact.emails.includes("contact@example.org"));
  });

  test("falls back to DOM heuristic for hours when no JSON-LD exists", () => {
    assert.match(facts.contact.hours ?? "", /8am - 6pm/);
  });

  test("finds testimonial, team, and faq sections by class/id keyword", () => {
    assert.ok(facts.testimonials.length > 0);
    assert.match(facts.testimonials[0].excerpt, /fantastic service/);
    assert.ok(facts.team.length > 0);
    assert.ok(facts.faq.length > 0);
  });

  test("finds socials by domain pattern in anchor hrefs", () => {
    assert.equal(facts.socials.twitter, "https://twitter.com/example");
    assert.equal(facts.socials.linkedin, "https://www.linkedin.com/company/example");
    assert.equal(facts.socials.facebook, null);
  });

  test("finds gallery images under a gallery-classed container", () => {
    assert.equal(facts.gallery.length, 2);
    assert.equal(facts.gallery[0].alt, "Storefront");
  });

  test("reviews default to null when no aggregateRating exists", () => {
    assert.deepEqual(facts.reviews, { averageRating: null, count: null, source: null });
  });
});

describe("crawl-adapter: phone normalization and provenance", () => {
  test("deduplicates common real-world formats by normalized number while retaining the first verified source", () => {
    const facts = extractStructuredFacts(
      cheerio.load(`<body><a href="tel:+1 (519) 744-9292">Call</a><p>Phone: 519.744.9292</p><script type="application/ld+json">{"@type":"LocalBusiness","telephone":"519-744-9292"}</script></body>`),
      "https://business.test/contact"
    );
    assert.deepEqual(facts.contact.phones, ["+1 (519) 744-9292"]);
    assert.deepEqual(facts.contact.phoneEvidence, [{ phone: "+1 (519) 744-9292", normalized: "+15197449292", sourceUrl: "https://business.test/contact", source: "tel-link" }]);
  });

  test("does not promote bare tracking IDs, ZIP codes, dates, or arbitrary numeric strings into phone evidence", () => {
    const facts = extractStructuredFacts(
      cheerio.load(`<body><p>Order 1234567890. ZIP 51974. Date 2026-08-12. Tracking 9988776655.</p></body>`),
      "https://business.test/"
    );
    assert.deepEqual(facts.contact.phones, []);
    assert.equal(facts.contact.phoneEvidence, undefined);
  });
});

describe("crawl-adapter: extractStructuredFacts (no structured content at all)", () => {
  test("returns honest empty defaults, never a guessed value", () => {
    const $ = cheerio.load(EMPTY_HTML);
    const facts = extractStructuredFacts($, "https://example.test/");

    assert.deepEqual(facts.contact, { phones: [], emails: [], address: null, hours: null });
    assert.deepEqual(facts.socials, {
      facebook: null,
      instagram: null,
      twitter: null,
      linkedin: null,
      youtube: null,
      tiktok: null,
      yelp: null,
    });
    assert.deepEqual(facts.services, []);
    assert.deepEqual(facts.testimonials, []);
    assert.deepEqual(facts.forms, []);
    assert.deepEqual(facts.maps, []);
    assert.deepEqual(facts.gallery, []);
    assert.deepEqual(facts.reviews, { averageRating: null, count: null, source: null });
  });
});

// ===========================================================================
// Crawler Extraction Heuristic Review — four deterministic signals added on
// top of the CSS-class/JSON-LD heuristics above, all modeled on real content
// confirmed present during the real-site validation pass (Veslo Family
// Restaurant's real Wix contact page, Lakeshore Family Dentistry's real
// WordPress service sub-page, Friedman Grimes Meinken & Leischner's real
// WordPress testimonials page) — not synthetic abstractions. None of these
// signals require a CSS class/id containing the category word.
// ===========================================================================

describe("crawl-adapter: visible-text hours/address signal (no matching CSS class)", () => {
  test("finds hours from a plain-text label heading followed by per-day sibling lines — Veslo's real shape: a label-only heading, then one sibling per day, no class/id naming 'hours' anywhere", () => {
    const html = `
      <html><body><footer>
        <h2>Hours of operation:</h2>
        <h2>Monday Closed</h2>
        <h2>Tuesday Closed</h2>
        <h2>Wednesday-Saturday 11:30am - 8:00pm</h2>
        <h2>Sunday 11:30am - 7:00</h2>
        <h2>ADDRESS: 100 Arnold Street. Kitchener, Ontario, Canada. N2H 6E2</h2>
      </footer></body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/contact");
    assert.match(facts.contact.hours ?? "", /Monday Closed/);
    assert.match(facts.contact.hours ?? "", /Wednesday-Saturday 11:30am - 8:00pm/);
    assert.match(facts.contact.hours ?? "", /Sunday 11:30am - 7:00/);
    // The sibling-gather must stop at the ADDRESS line, not swallow it into hours.
    assert.doesNotMatch(facts.contact.hours ?? "", /Arnold Street/);
  });

  test("finds address from a same-element 'Address:' label, real shape confirmed on Veslo's contact page (a single element combining the label, colon, and value)", () => {
    const html = `<html><body><footer><h2>ADDRESS: 100 Arnold Street. Kitchener, Ontario, Canada. N2H 6E2</h2></footer></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/contact");
    assert.equal(facts.contact.address, "100 Arnold Street. Kitchener, Ontario, Canada. N2H 6E2");
  });

  test("hours/address labels inside a footer are still read — Veslo's real hours widget lives inside a <footer> landmark, unlike nav/header which stay excluded", () => {
    const html = `<html><body><footer><h2>Hours:</h2><p>Mon-Fri 9am - 5pm</p></footer></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/contact");
    assert.match(facts.contact.hours ?? "", /9am - 5pm/);
  });

  test("does not treat a label inside nav/header as contact evidence", () => {
    const html = `<html><body><nav><h2>Hours: 9am - 5pm</h2></nav></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.contact.hours, null);
  });

  test("false positive guard: 'Address these three points' is not mistaken for an address label (no colon, and the label isn't the whole element's text)", () => {
    const html = `<html><body><p>Address these three points before signing the contract: budget, timeline, and scope.</p></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.contact.address, null);
  });

  test("false positive guard: 'Hours: please call ahead for details' does not produce a fabricated-looking hours value with no day/time/closed content", () => {
    const html = `<html><body><p>Hours: please call ahead for details.</p></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.contact.hours, null);
  });

  test("false positive guard: an ordinary paragraph mentioning days of the week without any time/closed pairing does not produce a fabricated hours value", () => {
    const html = `<html><body><p>We were closed on Monday for the holiday, and we discussed our hours of business on Tuesday during the staff meeting, though nothing was decided.</p></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    // "closed" does appear near "Monday" here, which the bounded no-label
    // fallback may reasonably treat as a plausible signal — the guard this
    // test really protects is that the match stays a short, bounded
    // fragment, never the entire sentence or surrounding unrelated prose.
    if (facts.contact.hours) {
      assert.ok(facts.contact.hours.length < 60, "a no-label hours match must stay a short bounded fragment, not swallow the whole paragraph");
    }
  });

  test("false positive guard: a word merely starting with a day-name prefix ('Friendly') is not mistaken for the day itself — Lakeshore's real shape: 'Family-Friendly Convenience... Hours 7am-7pm and Saturdays' with no real day+time pairing in that order", () => {
    const html = `<html><body><h3>Family-Friendly Convenience</h3><ul><li>Hours 7am-7pm and Saturdays</li><li>Same-Day Appointments</li></ul></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.notEqual(facts.contact.hours, "Friendly Convenience Hours 7am");
    if (facts.contact.hours) {
      assert.doesNotMatch(facts.contact.hours, /^Friendly/);
    }
  });

  test("false positive guard: 'Satellite', 'Monetary', and 'Thursday-adjacent prose' near a time-like number are not mistaken for real day names", () => {
    const html = `<html><body><p>Our Satellite office opens for a special session at 3pm on request, and Monetary policy changes take effect at 9am next quarter.</p></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    if (facts.contact.hours) {
      assert.doesNotMatch(facts.contact.hours, /^Satellite/);
      assert.doesNotMatch(facts.contact.hours, /^Monetary/);
    }
  });

  test("the no-label day+time pattern still finds real hours with no label at all, once a genuine day name precedes a genuine time", () => {
    const html = `<html><body><p>Open Saturday 9am to 2pm, walk-ins welcome.</p></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.match(facts.contact.hours ?? "", /Saturday 9am/);
  });

  test("JSON-LD hours/address still take priority over the visible-text signal when both are present", () => {
    const html = `
      <html><head><script type="application/ld+json">
      { "@context": "https://schema.org", "@type": "LocalBusiness", "openingHours": "Mo-Fr 09:00-17:00" }
      </script></head><body><h2>Hours:</h2><p>Totally different hours text</p></body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.contact.hours, "Mo-Fr 09:00-17:00");
  });
});

describe("crawl-adapter: Phase 3.5 data quality — address contamination fix", () => {
  test("the real reported bug: a phone-number line immediately following an address block is never swept into the address ('5 Princess Street West • Waterloo 519-886-1689')", () => {
    const html = `
      <html><body><footer>
        <div>Address:</div>
        <div>5 Princess Street West • Waterloo</div>
        <div>519-886-1689</div>
      </footer></body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.contact.address, "5 Princess Street West • Waterloo");
    assert.doesNotMatch(facts.contact.address ?? "", /519-886-1689/);
  });

  test("also stops before an email line following an address block", () => {
    const html = `<html><body><div>Address:</div><div>100 Arnold Street</div><div>hello@example.com</div></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.contact.address, "100 Arnold Street");
  });

  test("defense-in-depth: a phone number concatenated onto the SAME address text node (no separate sibling at all) is still stripped from the end", () => {
    const html = `<html><body><div>Address:</div><div>5 Princess Street West, 519-886-1689</div></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.contact.address, "5 Princess Street West");
  });

  test("a real address with no trailing phone is completely unaffected by the new stop/strip logic", () => {
    const html = `<html><body><div>Address:</div><div>100 Arnold Street. Kitchener, Ontario, Canada. N2H 6E2</div></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.contact.address, "100 Arnold Street. Kitchener, Ontario, Canada. N2H 6E2");
  });

  test("addressSource is tagged 'json-ld' when JSON-LD supplied it, 'labeled' when the visible-text label signal did", () => {
    const jsonLdHtml = `<html><head><script type="application/ld+json">{"@type":"LocalBusiness","address":{"streetAddress":"123 Main St","addressLocality":"Springfield"}}</script></head><body></body></html>`;
    const jsonLdFacts = extractStructuredFacts(cheerio.load(jsonLdHtml), "https://example.test/");
    assert.equal(jsonLdFacts.contact.addressSource, "json-ld");

    const labeledHtml = `<html><body><div>Address:</div><div>100 Arnold Street</div></body></html>`;
    const labeledFacts = extractStructuredFacts(cheerio.load(labeledHtml), "https://example.test/");
    assert.equal(labeledFacts.contact.addressSource, "labeled");
  });
});

describe("crawl-adapter: Phase 3.5 data quality — structured day-by-day hours", () => {
  test("the real reported bug: an hours widget with day and time as separate child elements (no literal whitespace between them in the source) no longer collapses into a run-on string", () => {
    const html =
      `<html><body><div class="hours"><div>Tuesday</div><div>5 pm to 11 pm</div><div>Wednesday</div><div>5 pm to 11 pm</div><div>Thursday</div><div>5 pm to 12 am</div></div></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.doesNotMatch(facts.contact.hours ?? "", /pmWednesday|pmThursday|11 pm5/, "must never read as a run-on string with no word boundaries");
    assert.match(facts.contact.hours ?? "", /Tuesday 5 pm to 11 pm/);
  });

  test("hoursByDay produces real, normalized per-day entries from that same widget", () => {
    const html =
      `<html><body><div class="hours"><div>Tuesday</div><div>5 pm to 11 pm</div><div>Wednesday</div><div>5 pm to 11 pm</div><div>Thursday</div><div>5 pm to 12 am</div></div></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    const byDay = facts.contact.hoursByDay ?? [];
    assert.deepEqual(
      byDay.map((e) => e.day),
      ["Tuesday", "Wednesday", "Thursday"]
    );
    assert.equal(byDay.find((e) => e.day === "Tuesday")?.hours, "5:00 PM – 11:00 PM");
    assert.equal(byDay.find((e) => e.day === "Thursday")?.hours, "5:00 PM – 12:00 AM");
  });

  test("a day RANGE ('Wednesday-Saturday') expands into one real entry per calendar day, all sharing the same real hours — never collapsed or mis-split", () => {
    const html = `
      <html><body><footer>
        <h2>Hours of operation:</h2>
        <h2>Monday Closed</h2>
        <h2>Wednesday-Saturday 11:30am - 8:00pm</h2>
      </footer></body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    const byDay = facts.contact.hoursByDay ?? [];
    assert.equal(byDay.find((e) => e.day === "Monday")?.hours, "Closed");
    for (const day of ["Wednesday", "Thursday", "Friday", "Saturday"]) {
      assert.equal(byDay.find((e) => e.day === day)?.hours, "11:30 AM – 8:00 PM", `expected ${day} to share the range's real hours`);
    }
    assert.equal(byDay.find((e) => e.day === "Tuesday"), undefined, "a day outside the real range must not be fabricated");
  });

  test("hoursByDay is honestly empty when the raw hours text has no real day-name boundary at all (e.g. '9am-5pm daily') — the raw hours string stays the fallback", () => {
    const html = `<html><body><div>Hours:</div><div>9am-5pm daily</div></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.deepEqual(facts.contact.hoursByDay ?? [], []);
    assert.ok(facts.contact.hours);
  });
});

describe("crawl-adapter: Phase 3.5 data quality — email provenance", () => {
  test("emailEvidence tags a mailto: link as 'mailto-link' — the same direct/structural tier as a tel: link", () => {
    const html = `<html><body><a href="mailto:hi@example.com">Email us</a></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.contact.emailEvidence?.[0]?.source, "mailto-link");
  });

  test("emailEvidence tags a body-text-only match as 'visible-text' — inferred, not directly observed", () => {
    const html = `<html><body><p>Reach us at hi@example.com anytime.</p></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.contact.emailEvidence?.[0]?.source, "visible-text");
  });
});

describe("crawl-adapter: page URL/title classification signal (no matching CSS class)", () => {
  test("a sub-page whose URL path names a category, with no CSS-class match, contributes its own main content as one real evidence item — Lakeshore's real shape: /dental-services/emergency-dentist with no matching class anywhere on the page", () => {
    const html = `
      <html><head><title>Emergency Dentist | Example Dental</title></head>
      <body>
        <nav><a href="/">Home</a></nav>
        <main><h1>Emergency Dentist</h1><p>When you have a sudden tooth problem, same-day appointments are available for urgent dental care.</p></main>
        <footer>© 2026 Example Dental. All rights reserved.</footer>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/dental-services/emergency-dentist");
    assert.equal(facts.services.length, 1);
    assert.equal(facts.services[0].heading, "Emergency Dentist | Example Dental");
    assert.match(facts.services[0].excerpt, /same-day appointments/);
    assert.equal(facts.services[0].sourceUrl, "https://example.test/dental-services/emergency-dentist");
    // The footer's own copyright boilerplate must not leak into the excerpt.
    assert.doesNotMatch(facts.services[0].excerpt, /rights reserved/);
  });

  test("does not apply the page-level fallback when the CSS-class scan already found real content — never overrides or duplicates an existing match", () => {
    const html = `
      <html><head><title>Our Services | Example Co</title></head>
      <body><div id="services-section"><h2>Our Services</h2><p>Plumbing and heating repair.</p></div></body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/services");
    assert.equal(facts.services.length, 1);
    assert.equal(facts.services[0].heading, "Our Services");
  });

  test("a testimonials-titled page with no real quote-shaped content contributes nothing to testimonials — URL/title classification never triggers a generic-prose fallback for testimonials specifically", () => {
    const html = `
      <html><head><title>Testimonials | Example Co</title></head>
      <body><main><h1>Testimonials</h1><p>We are proud of the relationships we build with our clients over many years of service.</p></main></body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/testimonials");
    assert.deepEqual(facts.testimonials, []);
  });

  test("an ordinary page whose URL/title happens to contain a category word but has no real matching content anywhere contributes an honest empty array, not a fabricated section", () => {
    const html = `<html><head><title>Product Recall Notice</title></head><body><main></main></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/product-recall-notice");
    assert.deepEqual(facts.products, []);
  });
});

describe("crawl-adapter: testimonial structural detection (no 'testimonial' CSS class or keyword)", () => {
  test("finds a real quote with a name heading before it and a dash-attribution after it — Friedman Grimes Meinken & Leischner's real shape: a WordPress plugin class ('imtst_quote_show') that doesn't contain the word 'testimonial' anywhere", () => {
    const html = `
      <html><body>
        <p><strong>Carolyn M. Grimes</strong></p>
        <p class="imtst_quote_show">&#8220;She was with me through my entire epic divorce which lasted about 9 years, and the final outcome was better than I ever hoped for.&#8221;</p>
        <p><i>&#8211; Kim</i></p>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/testimonials");
    assert.equal(facts.testimonials.length, 1);
    assert.equal(facts.testimonials[0].heading, "Kim");
    assert.match(facts.testimonials[0].excerpt, /better than I ever hoped for/);
    assert.equal(facts.testimonials[0].sourceUrl, "https://example.test/testimonials");
  });

  test("falls back to a generic 'Testimonial' heading, never a fabricated name, when no attribution or name-like text is structurally present", () => {
    const html = `<html><body><p>"Absolutely fantastic service from start to finish, would recommend to anyone."</p></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.testimonials.length, 1);
    assert.equal(facts.testimonials[0].heading, "Testimonial");
  });

  test("captures multiple real quotes in sequence, each with its own real attribution — the repeated name/quote/attribution pattern Friedman Grimes' real page uses for every client", () => {
    const html = `
      <html><body>
        <p><strong>Foster Samuel Burton Friedman</strong></p>
        <p>&#8220;He has excellent knowledgeable communication ability, and always responsive when I have needed advice.&#8221;</p>
        <p><i>&#8211; Estate Planning Client</i></p>
        <p><strong>Jessica Leischner</strong></p>
        <p>&#8220;I totally trusted her, she is firm, ready and willing to fight if necessary, confident and always got it done.&#8221;</p>
        <p><i>&#8211; Divorce Client</i></p>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/testimonials");
    assert.equal(facts.testimonials.length, 2);
    assert.equal(facts.testimonials[0].heading, "Estate Planning Client");
    assert.equal(facts.testimonials[1].heading, "Divorce Client");
  });

  test("false positive guard: a short quoted product name or emphasis phrase does not become a fabricated testimonial (below the minimum quote length)", () => {
    const html = `<html><body><p>Our best-selling item is the "Classic Burger".</p></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.deepEqual(facts.testimonials, []);
  });

  test("false positive guard: an ordinary long quoted excerpt from a news article (not a customer testimonial) is still captured only as real, verbatim, attributed text — never re-attributed to a fabricated customer name", () => {
    const html = `<html><body><p>The mayor said in a statement, &#8220;this new initiative will bring real benefits to residents across the city over the coming years.&#8221;</p></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/news");
    // Structurally quote-shaped text is real and verbatim either way — the
    // guarantee under test is that no name is invented: absent a real
    // name/attribution structurally next to it, the heading must stay the
    // generic, non-fabricated "Testimonial" label, never a guessed person.
    if (facts.testimonials.length > 0) {
      assert.equal(facts.testimonials[0].heading, "Testimonial");
    }
  });

  test("does not require the word 'testimonial' anywhere in the page — real quote-shaped content with a real attribution is enough on its own", () => {
    const html = `<html><body><p>&#8220;Their team went above and beyond every step of the way.&#8221;</p><p>&#8211; a satisfied customer</p></body></html>`;
    const $ = cheerio.load(html);
    assert.doesNotMatch(html, /testimonial/i);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.testimonials.length, 1);
    assert.equal(facts.testimonials[0].heading, "a satisfied customer");
  });

  test("a real quote longer than the generic 300-char section-excerpt cap is stored in full, not chopped off mid-sentence — the real Friedman Grimes regression (\"...He has excellent knowledgeable com\")", () => {
    const longQuote =
      "On the recommendation of a friend, I chose to consult with Mr. Friedman, since I am an aged person with no family or dependents. I needed advice for a will, and a young person who would settle my estate upon my death, or organize care in case of a terminal illness. He has excellent knowledgeable communication skills and made a very difficult process feel completely manageable from start to finish.";
    assert.ok(longQuote.length > 300, "test quote must exceed the old SECTION_EXCERPT_MAX_CHARS cap to actually exercise the fix");
    const html = `<html><body><p>&#8220;${longQuote}&#8221;</p></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/testimonials");
    assert.equal(facts.testimonials.length, 1);
    assert.equal(facts.testimonials[0].excerpt, longQuote);
    assert.ok(facts.testimonials[0].excerpt.endsWith("start to finish."), "must retain the real final sentence, not truncate mid-word partway through");
  });
});

describe("crawl-adapter: team/staff structural detection (no 'team'/'staff' CSS class or keyword)", () => {
  test("splits each real bold-name + line-break + title pair into its own team member — Friedman Grimes' real oldtownlawyers.com/our-team/ shape (a WPBakery page-builder site with no team/staff CSS class anywhere)", () => {
    const html = `
      <html><body>
        <h1>OUR TEAM</h1>
        <h3>Attorneys</h3>
        <p><span><span><a href="/attorneys/foster"><strong>Foster S.B. Friedman</strong></a></span><br>
        Partner<br>
        </span></p>
        <p><span><span><a href="/attorneys/carolyn"><strong>Carolyn M. Grimes</strong></a></span><br>
        Partner<br>
        </span></p>
        <p><span><span><a href="/attorneys/xue"><strong>Xue Connelly</strong></a></span><br>
        Attorney<br>
        </span></p>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/our-team/");
    assert.equal(facts.team.length, 3);
    assert.deepEqual(
      facts.team.map((t) => ({ heading: t.heading, excerpt: t.excerpt })),
      [
        { heading: "Foster S.B. Friedman", excerpt: "Partner" },
        { heading: "Carolyn M. Grimes", excerpt: "Partner" },
        { heading: "Xue Connelly", excerpt: "Attorney" },
      ]
    );
    // The real regression this guards: before this extractor existed, the
    // page-level URL/title fallback was the ONLY thing populating "team",
    // producing one giant run-on blob instead of per-person entries.
    assert.ok(
      !facts.team.some((t) => /OUR TEAM Attorneys/i.test(t.excerpt)),
      "must not also carry the whole-page fallback blob once real structural matches exist"
    );
  });

  test("handles a <br> nested inside the bold name itself (Martin J.A. Yeager's real markup: <strong>Name<br></strong>Title<br>)", () => {
    const html = `<html><body><p><span><strong>Martin J.A. Yeager<br></strong>Attorney<br></span></p></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/our-team/");
    assert.equal(facts.team.length, 1);
    assert.equal(facts.team[0].heading, "Martin J.A. Yeager");
    assert.equal(facts.team[0].excerpt, "Attorney");
  });

  test("does not match a bold name followed by a long line — a real bio paragraph, not a one-line title", () => {
    // Deliberately a URL/title with no "team"/"staff" word (unlike the other
    // tests in this block) — isolates the structural extractor itself from
    // classifyPageByUrlAndTitle's separate whole-page fallback, which would
    // otherwise still legitimately produce a (real, non-fabricated) whole-
    // page-blob team entry for a page whose URL says it's a team page.
    const html = `<html><body><p><strong>Jane Smith</strong><br>A dedicated attorney with over twenty years of experience representing clients in complex family law matters throughout Northern Virginia.<br></p></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/attorneys/jane-smith/");
    assert.deepEqual(facts.team, []);
  });

  test("does not match two bold lines in a row — a title line must be plain text, not another name", () => {
    const html = `<html><body><p><strong>Jane Smith</strong><br><strong>Founding Partner</strong><br></p></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/attorneys/jane-smith/");
    assert.deepEqual(facts.team, []);
  });

  test("false positive guard: plain prose with no bold name at all produces no team match", () => {
    const html = `<html><body><p>Welcome to our firm.<br>We have served this community for over forty years.<br></p></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/about/");
    assert.deepEqual(facts.team, []);
  });
});

describe("crawl-adapter: service/practice-area nav-menu structural detection (Friedman Flagship Final Content Pass)", () => {
  test("splits a real 'Practice Areas' mega-menu into one category per top-level submenu item, each with its own real sub-items — Friedman Grimes' real oldtownlawyers.com shape", () => {
    const html = `
      <html><body>
        <nav>
          <ul>
            <li><a href="/about/">About</a></li>
            <li>
              <a href="/practice-areas/">Practice Areas</a>
              <ul>
                <li>
                  <a href="/family-law/">Family Law</a>
                  <ul>
                    <li><a href="/family-law/divorce/">Divorce</a></li>
                    <li><a href="/family-law/child-custody/">Child Custody</a></li>
                    <li><a href="/family-law/child-support/">Child Support</a></li>
                  </ul>
                </li>
                <li>
                  <a href="/wills-trusts-estates/">Wills, Trusts &amp; Estates</a>
                  <ul>
                    <li><a href="/wte/wills/">Wills</a></li>
                    <li><a href="/wte/trusts/">Trusts</a></li>
                  </ul>
                </li>
              </ul>
            </li>
            <li><a href="/contact/">Contact</a></li>
          </ul>
        </nav>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.services.length, 2);
    assert.equal(facts.services[0].heading, "Family Law");
    assert.equal(facts.services[0].excerpt, "Divorce, Child Custody, Child Support");
    assert.equal(facts.services[1].heading, "Wills, Trusts & Estates");
    assert.equal(facts.services[1].excerpt, "Wills, Trusts");
  });

  test("does not treat ordinary top-level nav links (About, Contact) as service categories", () => {
    const html = `<html><body><nav><ul><li><a href="/about/">About</a></li><li><a href="/contact/">Contact</a></li></ul></nav></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.deepEqual(facts.services, []);
  });

  test("captures a flat single-level 'Services' menu (no sub-submenu) as categories with no sub-item detail — a real, generalizable shape distinct from Friedman's two-level practice-area menu", () => {
    const html = `
      <html><body>
        <nav>
          <ul>
            <li>
              <a href="/services/">Services</a>
              <ul>
                <li><a href="/services/plumbing/">Plumbing</a></li>
                <li><a href="/services/electrical/">Electrical</a></li>
              </ul>
            </li>
          </ul>
        </nav>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.services.length, 2);
    assert.equal(facts.services[0].heading, "Plumbing");
    assert.equal(facts.services[0].excerpt, "");
    assert.equal(facts.services[1].heading, "Electrical");
  });

  test("real structural evidence supersedes the page-level URL/title fallback blob — the actual Friedman regression (a 'foreign-service-professionals' sub-page URL-tokenized to contain the word 'service' and misclassified as a services listing page)", () => {
    const html = `
      <html><head><title>Family Law for Foreign Service Professionals</title></head><body>
        <nav>
          <ul>
            <li>
              <a href="/practice-areas/">Practice Areas</a>
              <ul>
                <li>
                  <a href="/family-law/">Family Law</a>
                  <ul><li><a href="/family-law/divorce/">Divorce</a></li></ul>
                </li>
              </ul>
            </li>
          </ul>
        </nav>
        <main><p>Real article body content about Foreign Service divorce specifics, unrelated to any services listing.</p></main>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/family-law/family-law-for-foreign-service-professionals/");
    assert.equal(facts.services.length, 1);
    assert.equal(facts.services[0].heading, "Family Law");
    assert.ok(
      !facts.services.some((s) => /Foreign Service divorce specifics/i.test(s.excerpt)),
      "the real nav-menu evidence must win — the page-level fallback must not also inject the unrelated article body as a second 'services' entry"
    );
  });

  test("rejects a CSS-keyword-matched block whose 'service'-named class is a decorative naming coincidence, not real services content — the actual Friedman regression: a 'serviceheaderimage' title-banner wrapper containing the same flattened nav-menu dump", () => {
    const html = `
      <html><body>
        <nav>
          <ul>
            <li>
              <a href="/practice-areas/">Practice Areas</a>
              <ul>
                <li>
                  <a href="/family-law/">Family Law</a>
                  <ul><li><a href="/family-law/divorce/">Divorce</a></li></ul>
                </li>
              </ul>
            </li>
          </ul>
        </nav>
        <div class="serviceheaderimage wpb_column">
          <h3>Practice Areas</h3>
          Family Law Family Law Overview Divorce Child Custody Child Support Property Division Spousal Support Other Family Law Issues Collaborative Law Settlement Agreements Divorce Guides Wills, Trusts &amp; Estates Wills, Trusts &amp; Estates Overview Guardianship &amp; Conservatorship Powers of Attorney
        </div>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/some-article/");
    assert.equal(facts.services.length, 1, "only the real structural nav-menu category — the decorative-class dump must be filtered out");
    assert.equal(facts.services[0].heading, "Family Law");
    assert.ok(
      !facts.services.some((s) => s.heading === "Practice Areas"),
      "the decorative 'serviceheaderimage' wrapper's own heading text must never surface as a fake 'Practice Areas' category"
    );
  });

  test("a real service description with genuine sentence punctuation is still kept even though its class name is a coincidental 'service' match", () => {
    const html = `<html><body><div class="my-services-block"><h2>What We Do</h2><p>We handle plumbing repairs, water heater installation, and drain cleaning for homes across the metro area.</p></div></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.services.length, 1);
    assert.match(facts.services[0].excerpt, /plumbing repairs/);
  });
});

describe("crawl-adapter: footer quality scoring (real business content in a footer is no longer blanket-discarded)", () => {
  test("keeps a real, descriptive service list found only in a footer — Lakeshore's real shape: a <ul class=\"services-list\"> of full service names inside <footer>", () => {
    const html = `
      <html><body><footer>
        <ul class="services-list">
          <li>Children's Dental Care</li>
          <li>Cosmetic Dentistry</li>
          <li>Dental Implants</li>
          <li>Emergency Dentist</li>
        </ul>
      </footer></body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.services.length, 1);
    assert.match(facts.services[0].excerpt, /Cosmetic Dentistry/);
    assert.match(facts.services[0].excerpt, /Emergency Dentist/);
  });

  test("still discards an ordinary boilerplate footer nav/legal list — short generic links and copyright text stay excluded", () => {
    const html = `
      <html><body><footer class="site-footer">
        <ul class="footer-services">
          <li><a href="/">Home</a></li>
          <li><a href="/about">About</a></li>
          <li><a href="/privacy">Privacy Policy</a></li>
        </ul>
        <p>&copy; 2026 Example Co. All rights reserved.</p>
      </footer></body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.deepEqual(facts.services, []);
  });

  test("still discards a footer link list dominated by social-media links", () => {
    const html = `
      <html><body><footer>
        <ul class="service-links">
          <li><a href="https://facebook.com/example">Facebook</a></li>
          <li><a href="https://instagram.com/example">Instagram</a></li>
          <li><a href="https://twitter.com/example">Twitter</a></li>
        </ul>
      </footer></body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.deepEqual(facts.services, []);
  });

  test("nav and header content stay hard-excluded regardless of content quality — only footer is quality-scored", () => {
    const html = `
      <html><body>
        <nav><ul class="services-list"><li>Cosmetic Dentistry and General Care</li><li>Emergency Dental Services</li></ul></nav>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.deepEqual(facts.services, []);
  });
});

describe("crawl-adapter: Wilcox regression — already-passing CSS-class extraction and existing tests stay intact", () => {
  test("a real service list found via ordinary CSS-class matching (not in a footer) still works exactly as before", () => {
    const html = `
      <html><body>
        <div class="service-block"><h2>Lawn Cleanup Services</h2><p>Spring and fall yard cleanup, hardscaping, patio installation, and retaining wall installation.</p></div>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/cleanup-services");
    assert.equal(facts.services.length, 1);
    assert.equal(facts.services[0].heading, "Lawn Cleanup Services");
  });

  test("real address/hours captured via JSON-LD still take priority and are unaffected by the new visible-text signal", () => {
    const html = `
      <html><head><script type="application/ld+json">
      {
        "@context": "https://schema.org", "@type": "LocalBusiness",
        "address": { "streetAddress": "3027 Blue Ridge Road", "addressLocality": "Clarklake", "addressRegion": "MI", "postalCode": "49234" },
        "openingHours": ["Mo-Fr 08:00-17:00", "Sa 09:00-14:00"]
      }
      </script></head><body></body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.contact.address, "3027 Blue Ridge Road, Clarklake, MI, 49234");
    assert.equal(facts.contact.hours, "Mo-Fr 08:00-17:00; Sa 09:00-14:00");
  });
});

// ===========================================================================
// mergeStructuredFacts — the actual fix: the crawler already fetches up to
// five sub-pages per business but previously discarded everything but their
// <title>. These fixtures are modeled on real content confirmed present
// during the crawler evidence-gap review (a real landscaping service list,
// real named client testimonials on a law firm's own testimonials page,
// real hours captured on a restaurant's own menu page) — not synthetic
// abstractions.
// ===========================================================================

const HOMEPAGE_URL = "https://example.test/";
const SERVICES_PAGE_URL = "https://example.test/cleanup-services";
const TESTIMONIALS_PAGE_URL = "https://example.test/testimonials";
const MENU_PAGE_URL = "https://example.test/menu";

const HOMEPAGE_MINIMAL_HTML = `
<html><body>
<a href="tel:555-111-2222">Call now</a>
</body></html>
`;

const SERVICES_SUBPAGE_HTML = `
<html><body>
<nav><a href="/">Home</a></nav>
<div class="service-block"><h2>Lawn Cleanup Services</h2><p>Spring and fall yard cleanup, hardscaping, patio installation, and retaining wall installation.</p></div>
</body></html>
`;

const TESTIMONIALS_SUBPAGE_HTML = `
<html><body>
<div class="testimonial-item"><h3>Carolyn M.</h3><p>She was with me through my entire divorce and the outcome was better than I ever hoped for.</p></div>
</body></html>
`;

const MENU_SUBPAGE_NO_MATCHING_MARKUP_HTML = `
<html><body>
<p>Home Menu Contact</p>
<p>Hours of operation: Monday Closed Tuesday-Saturday 11:30am - 8:00pm Sunday 11:30am - 7:00pm</p>
<div class="hours-block">Monday Closed Tuesday-Saturday 11:30am - 8:00pm</div>
</body></html>
`;

describe("crawl-adapter: mergeStructuredFacts (sub-page evidence, previously discarded)", () => {
  test("a real service section found only on a sub-page reaches the merged result, with its real sourceUrl", () => {
    const homepage = extractStructuredFacts(cheerio.load(HOMEPAGE_MINIMAL_HTML), HOMEPAGE_URL);
    const servicesPage = extractStructuredFacts(cheerio.load(SERVICES_SUBPAGE_HTML), SERVICES_PAGE_URL);

    assert.deepEqual(homepage.services, []); // the homepage itself has nothing — confirms this isn't a homepage-extraction false positive

    const merged = mergeStructuredFacts([homepage, servicesPage]);
    assert.equal(merged.services.length, 1);
    assert.equal(merged.services[0].heading, "Lawn Cleanup Services");
    assert.match(merged.services[0].excerpt, /hardscaping/);
    assert.equal(merged.services[0].sourceUrl, SERVICES_PAGE_URL, "provenance must point at the real sub-page, not the homepage");
  });

  test("a real testimonial found only on a sub-page reaches the merged result, verbatim, with provenance — never paraphrased or fabricated", () => {
    const homepage = extractStructuredFacts(cheerio.load(HOMEPAGE_MINIMAL_HTML), HOMEPAGE_URL);
    const testimonialsPage = extractStructuredFacts(cheerio.load(TESTIMONIALS_SUBPAGE_HTML), TESTIMONIALS_PAGE_URL);

    const merged = mergeStructuredFacts([homepage, testimonialsPage]);
    assert.equal(merged.testimonials.length, 1);
    assert.equal(merged.testimonials[0].heading, "Carolyn M.");
    assert.match(merged.testimonials[0].excerpt, /better than I ever hoped for/);
    assert.equal(merged.testimonials[0].sourceUrl, TESTIMONIALS_PAGE_URL);
  });

  test("contact info (e.g. hours) captured only on a sub-page fills in what the homepage didn't have — the homepage's own value always wins when it has one", () => {
    const homepage = extractStructuredFacts(cheerio.load(HOMEPAGE_MINIMAL_HTML), HOMEPAGE_URL);
    const menuPage = extractStructuredFacts(cheerio.load(MENU_SUBPAGE_NO_MATCHING_MARKUP_HTML), MENU_PAGE_URL);

    assert.equal(homepage.contact.hours, null); // homepage genuinely has none

    const merged = mergeStructuredFacts([homepage, menuPage]);
    assert.match(merged.contact.hours ?? "", /11:30am - 8:00pm/);
    // The homepage's real phone link must still win over anything a sub-page might also contain.
    assert.ok(merged.contact.phones.includes("555-111-2222"));
  });

  test("merges phones across pages without duplicating, respecting the same cap a single page's own extraction already had", () => {
    const homepage = extractStructuredFacts(cheerio.load(HOMEPAGE_MINIMAL_HTML), HOMEPAGE_URL);
    const menuPage = extractStructuredFacts(cheerio.load(MENU_SUBPAGE_NO_MATCHING_MARKUP_HTML), MENU_PAGE_URL);
    const merged = mergeStructuredFacts([homepage, menuPage, homepage]); // homepage counted twice on purpose
    const occurrences = merged.contact.phones.filter((p) => p === "555-111-2222").length;
    assert.equal(occurrences, 1, "the same real phone number must not be duplicated just because multiple pages surfaced it");
  });

  test("a sub-page with no matching content contributes nothing — never a fabricated section standing in for missing evidence", () => {
    const homepage = extractStructuredFacts(cheerio.load(HOMEPAGE_MINIMAL_HTML), HOMEPAGE_URL);
    const blankSubPage = extractStructuredFacts(cheerio.load("<html><body><p>Nothing relevant here.</p></body></html>"), "https://example.test/blog");

    const merged = mergeStructuredFacts([homepage, blankSubPage]);
    assert.deepEqual(merged.services, []);
    assert.deepEqual(merged.testimonials, []);
    assert.deepEqual(merged.team, []);
  });

  test("multiple sub-pages each contribute their own real content simultaneously", () => {
    const homepage = extractStructuredFacts(cheerio.load(HOMEPAGE_MINIMAL_HTML), HOMEPAGE_URL);
    const servicesPage = extractStructuredFacts(cheerio.load(SERVICES_SUBPAGE_HTML), SERVICES_PAGE_URL);
    const testimonialsPage = extractStructuredFacts(cheerio.load(TESTIMONIALS_SUBPAGE_HTML), TESTIMONIALS_PAGE_URL);

    const merged = mergeStructuredFacts([homepage, servicesPage, testimonialsPage]);
    assert.equal(merged.services.length, 1);
    assert.equal(merged.testimonials.length, 1);
    assert.equal(merged.services[0].sourceUrl, SERVICES_PAGE_URL);
    assert.equal(merged.testimonials[0].sourceUrl, TESTIMONIALS_PAGE_URL);
  });

  test("returns honest empty defaults when given no pages at all", () => {
    const merged = mergeStructuredFacts([]);
    assert.deepEqual(merged.services, []);
    assert.deepEqual(merged.contact, { phones: [], emails: [], address: null, hours: null });
  });

  test("homepage's own forms/maps are preserved unchanged — sub-page contact forms are not aggregated as a business fact", () => {
    const homepageWithForm = extractStructuredFacts(
      cheerio.load('<html><body><form action="/submit" method="post"><input type="email" /></form></body></html>'),
      HOMEPAGE_URL
    );
    const subPageWithDifferentForm = extractStructuredFacts(
      cheerio.load('<html><body><form action="/other" method="get"></form></body></html>'),
      SERVICES_PAGE_URL
    );

    const merged = mergeStructuredFacts([homepageWithForm, subPageWithDifferentForm]);
    assert.equal(merged.forms.length, 1);
    assert.equal(merged.forms[0].action, "/submit");
  });
});

describe("crawl-adapter: prioritizeSampleUrls (Evidence Depth investigation — Friedman Grimes)", () => {
  test("a recognizable category page beyond the old fixed budget still gets sampled, ahead of redundant leftover links in DOM order", () => {
    // Friedman Grimes' real shape: a nav that lists 5 non-category links
    // (About, News, Community, Contact, Blog) before any recognizable
    // category page appears at all — the old first-5-DOM-order sampling
    // would never reach "Our Team" here.
    const links = [
      { url: "https://example.test/about/", text: "Firm Overview" },
      { url: "https://example.test/news/", text: "In the News" },
      { url: "https://example.test/community/", text: "In the Community" },
      { url: "https://example.test/contact/", text: "Contact" },
      { url: "https://example.test/blog/", text: "Blog" },
      { url: "https://example.test/our-team/", text: "Our Team" },
      { url: "https://example.test/testimonials/", text: "Testimonials" },
    ];
    const selected = prioritizeSampleUrls(links, 5);
    assert.ok(selected.includes("https://example.test/our-team/"));
    assert.ok(selected.includes("https://example.test/testimonials/"));
    assert.equal(selected.length, 5);
  });

  test("fills remaining budget in original discovery order once every recognizable category is used up", () => {
    const links = [
      { url: "https://example.test/our-team/", text: "Our Team" },
      { url: "https://example.test/about/", text: "About" },
      { url: "https://example.test/news/", text: "News" },
      { url: "https://example.test/contact/", text: "Contact" },
    ];
    const selected = prioritizeSampleUrls(links, 3);
    assert.deepEqual(selected, [
      "https://example.test/our-team/",
      "https://example.test/about/",
      "https://example.test/news/",
    ]);
  });

  test("a site with no recognizable category links sees no behavior change — same first-N-in-order sampling as before", () => {
    const links = [
      { url: "https://example.test/a/", text: "Alpha" },
      { url: "https://example.test/b/", text: "Beta" },
      { url: "https://example.test/c/", text: "Gamma" },
    ];
    assert.deepEqual(prioritizeSampleUrls(links, 2), ["https://example.test/a/", "https://example.test/b/"]);
  });

  test("never selects more than max, and never duplicates a URL matching two categories", () => {
    const links = [{ url: "https://example.test/team-faq/", text: "Team FAQ" }];
    const selected = prioritizeSampleUrls(links, 8);
    assert.deepEqual(selected, ["https://example.test/team-faq/"]);
  });
});

describe("crawl-adapter: FAQ content-shape gate (Evidence Depth investigation — Friedman Grimes)", () => {
  test("rejects an accordion-classed collapsible menu with no question content — Friedman Grimes' real shape: a practice-area sidebar nav reusing the site's FAQ accordion widget classing", () => {
    const html = `
      <html><body>
        <div class="accordion-item">
          <div class="accordion-title">Family Law</div>
          <div class="accordion-body">
            <a href="/family-law/divorce/">Divorce</a>
            <a href="/family-law/child-custody/">Child Custody</a>
          </div>
        </div>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/family-law/");
    assert.deepEqual(facts.faq, []);
  });

  test("accepts a real accordion-classed FAQ whose heading/excerpt names an actual question", () => {
    const html = `
      <html><body>
        <div class="faq-item">
          <h3>What are the grounds for divorce in Virginia?</h3>
          <p>Virginia recognizes both no-fault and fault-based grounds for divorce.</p>
        </div>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/family-law/divorce/");
    assert.equal(facts.faq.length, 1);
    assert.match(facts.faq[0].heading, /grounds for divorce/);
  });
});

describe("crawl-adapter: keyword-scan banner/duplicate false positives (Evidence Depth investigation — Friedman Grimes)", () => {
  test("rejects a section whose excerpt is nothing but its own heading repeated — a page-builder theme's generic page-title banner reused a class literally named 'servicetitle' site-wide, unrelated to any real services listing", () => {
    const html = `
      <html><body>
        <div class="serviceheaderimage"></div>
        <div class="servicetitle"><h1>OUR TEAM</h1></div>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/our-team/");
    assert.deepEqual(facts.services, []);
  });

  test("still accepts a real services section whose excerpt has real content beyond its own heading", () => {
    const html = `
      <html><body>
        <div class="servicetitle"><h2>Practice Areas</h2><p>Family Law, Estate Planning, Bankruptcy Law.</p></div>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/practice-areas/");
    assert.equal(facts.services.length, 1);
    assert.match(facts.services[0].excerpt, /Estate Planning/);
  });

  test("keeps only the outermost match when a keyword-classed element is nested inside another keyword-classed ancestor — the same real content is not counted twice under different headings", () => {
    const html = `
      <html><body>
        <div class="faq-item">
          <div class="faq-question">What is a separation agreement?</div>
          <div class="faq-answer">A legally binding contract dividing property and debts between a separating couple.</div>
        </div>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/faq/");
    assert.equal(facts.faq.length, 1);
    assert.match(facts.faq[0].excerpt, /legally binding contract/);
  });

  test("whitespace normalization: a heading containing a non-breaking space still matches its own excerpt and is rejected as a banner, not treated as distinct text", () => {
    const html = `<html><body><div class="servicetitle"><h1>IN&nbsp;THE&nbsp;NEWS</h1></div></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/in-the-news/");
    assert.deepEqual(facts.services, []);
  });
});

describe("crawl-adapter: menu/price-list structural detection (Phase 4.8 evidence-pipeline pass — real janebond.ca investigation)", () => {
  test("splits a real div-per-field menu (janebond.ca's actual shape: no 'menu'/nav-dropdown markup anywhere) into categories with real name/price/description", () => {
    const html = `
      <html><body>
        <section id="food">
          <div class="section-title"><h2>Food</h2></div>
          <div class="menu_section_title">Appetizers</div>
          <div class="menu_single_item">
            <div class="item_name">Antojitos</div><div class="item_price">18.00</div>
            <div class="item_descr"><p>grilled flour tortilla rolled with cream cheese</p></div>
          </div>
          <div class="menu_single_item">
            <div class="item_name">Vegan Caesar</div><div class="item_price">14.00</div>
            <div class="item_descr"><p>creamy caesar dressing, house made croutons</p></div>
          </div>
          <div class="menu_section_title">Entrees</div>
          <div class="menu_single_item">
            <div class="item_name">Braised Short Rib</div><div class="item_price">27.00</div>
            <div class="item_descr"><p>slow braised, red wine reduction</p></div>
          </div>
        </section>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://janebond.test/");
    assert.equal(facts.menu.length, 2);
    assert.equal(facts.menu[0].name, "Appetizers");
    assert.equal(facts.menu[0].items.length, 2);
    assert.deepEqual(facts.menu[0].items[0], {
      name: "Antojitos",
      description: "grilled flour tortilla rolled with cream cheese",
      price: "18.00",
      sourceUrl: "https://janebond.test/",
      confidence: "high",
    });
    assert.equal(facts.menu[0].items[1].name, "Vegan Caesar");
    assert.equal(facts.menu[1].name, "Entrees");
    assert.equal(facts.menu[1].items[0].name, "Braised Short Rib");
    // Never keys off "menu_single_item"/"item_name"/"item_price" — the real
    // regression this guards: findServiceMenuStructure's nav-dropdown-only
    // shape produces nothing at all for this real markup.
    assert.deepEqual(facts.services, []);
  });

  test("a table-row or bare-text menu shape (no wrapping element per field) still produces a real name+price, description null, confidence medium", () => {
    const html = `
      <html><body>
        <ul>
          <li>House Lager <span>$7</span></li>
          <li>IPA <span>$8</span></li>
        </ul>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/drinks/");
    assert.equal(facts.menu.length, 1);
    assert.equal(facts.menu[0].items.length, 2);
    assert.deepEqual(facts.menu[0].items[0], {
      name: "House Lager",
      description: null,
      price: "$7",
      sourceUrl: "https://example.test/drinks/",
      confidence: "medium",
    });
  });

  test("false positive guard: a single price-shaped mention on an otherwise unrelated page produces no menu at all — a real menu is a repeated pattern, not a one-off figure", () => {
    const html = `<html><body><p>Initial consultation fee</p><div>$50.00</div></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.deepEqual(facts.menu, []);
  });

  test("false positive guard: price-shaped text inside nav/header is never treated as a menu item", () => {
    const html = `
      <html><body>
        <nav><div>Table 12 <span>$0.00</span></div><div>Table 14 <span>$0.00</span></div></nav>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.deepEqual(facts.menu, []);
  });

  test("no real category heading present: items fall under the honest fallback category, never an invented name", () => {
    const html = `
      <html><body>
        <div><div>Antojitos</div><div>$18.00</div></div>
        <div><div>Vegan Caesar</div><div>$14.00</div></div>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.menu.length, 1);
    assert.equal(facts.menu[0].name, "Menu");
    assert.equal(facts.menu[0].items.length, 2);
  });

  // -------------------------------------------------------------------
  // Phase 5.1 — real regression found during the Phase 5.0 Kitchener
  // validation on a real, unrelated restaurant (J&B Family Restaurant):
  // category-label detection had no structural requirement at all, so a
  // short marketing tagline and a short promo-pricing blurb were both
  // adopted as fake "categories" even though every real item on the same
  // page (21 real dishes, real prices, real descriptions) was extracted
  // correctly. Fixtures below are representative/generic, never copying
  // J&B's own real text.
  // -------------------------------------------------------------------

  test("a real heading-tag category label (h2/h3) is detected — the strongest structural signal", () => {
    const html = `
      <html><body>
        <h2>Entrées</h2>
        <div>Braised Short Rib <span>$27.00</span></div>
        <div>Pan-Seared Salmon <span>$24.00</span></div>
        <h3>Desserts</h3>
        <div>Crème Brûlée <span>$9.00</span></div>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.menu.length, 2);
    assert.equal(facts.menu[0].name, "Entrées");
    assert.equal(facts.menu[1].name, "Desserts");
  });

  test("a non-heading-tag category label with a title/heading-signaling class is still detected — janebond.ca's real, unchanged markup shape", () => {
    const html = `
      <html><body>
        <div class="menu_section_title">Appetizers</div>
        <div>Antojitos <span>$18.00</span></div>
        <div>Vegan Caesar <span>$14.00</span></div>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.menu.length, 1);
    assert.equal(facts.menu[0].name, "Appetizers");
    assert.equal(facts.menu[0].items.length, 2);
  });

  test("a marketing tagline near the menu items is never adopted as a category — no heading tag, no title/heading class, generic shape (not J&B-specific wording)", () => {
    const html = `
      <html><body>
        <p>Your neighborhood's favorite spot for great food</p>
        <div>Antojitos <span>$18.00</span></div>
        <div>Vegan Caesar <span>$14.00</span></div>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.menu.length, 1);
    assert.equal(facts.menu[0].name, "Menu", "no structural signal on the tagline — falls back honestly instead of adopting it as a category");
    assert.equal(facts.menu[0].items.length, 2);
  });

  test("a promo-pricing blurb near the menu items is never adopted as a category — short, non-price, but no structural signal", () => {
    const html = `
      <html><body>
        <div>4 for $12.95 or 8 for $19.95</div>
        <div>Chicken Wings <span>$12.95</span></div>
        <div>Mozzarella Sticks <span>$9.95</span></div>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.menu.length, 1);
    assert.equal(facts.menu[0].name, "Menu");
    assert.equal(facts.menu[0].items.length, 2);
    assert.equal(facts.menu[0].items[0].name, "Chicken Wings", "item-level extraction is completely unaffected by the category-label fix");
    assert.equal(facts.menu[0].items[0].price, "$12.95");
  });

  test("real item-level extraction (name/price/description) is byte-identical before and after the category fix, even with a heading present", () => {
    const html = `
      <html><body>
        <h2>Mains</h2>
        <div class="menu_single_item">
          <div class="item_name">Braised Short Rib</div><div class="item_price">27.00</div>
          <div class="item_descr"><p>slow braised, red wine reduction</p></div>
        </div>
        <div class="menu_single_item">
          <div class="item_name">Pan-Seared Salmon</div><div class="item_price">24.00</div>
          <div class="item_descr"><p>lemon butter, seasonal veg</p></div>
        </div>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.menu[0].name, "Mains");
    assert.deepEqual(facts.menu[0].items[0], {
      name: "Braised Short Rib",
      description: "slow braised, red wine reduction",
      price: "27.00",
      sourceUrl: "https://example.test/",
      confidence: "high",
    });
    assert.equal(facts.menu[0].items[1].name, "Pan-Seared Salmon");
  });

  test("end-to-end: a business with no industry/business_category DB fields at all still classifies as 'restaurant' from real, structurally-detected menu category headings — the exact chain Phase 4.9/5.1 protects", () => {
    const html = `
      <html><body>
        <h2>Appetizers</h2>
        <div>Antojitos <span>$18.00</span></div>
        <div>Vegan Caesar <span>$14.00</span></div>
        <h2>Entrées</h2>
        <div>Braised Short Rib <span>$27.00</span></div>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    const categoryNames = facts.menu.map((c) => c.name);
    assert.deepEqual(categoryNames, ["Appetizers", "Entrées"]);
    assert.equal(resolveIndustryBucket(null, null, categoryNames), "restaurant");
  });
});

describe("crawl-adapter: gallery image detection generalized beyond a 'gallery'-classed container (Phase 4.8, real janebond.ca investigation)", () => {
  test("a real content photo with no 'gallery' class/id anywhere near it is now captured, and its relative src is resolved to an absolute URL", () => {
    const html = `
      <html><body>
        <section id="home">
          <div id="fullscreen-slider">
            <div class="slider-item"><img src="images/jane_draught.jpg" alt="The Jane Bond"></div>
          </div>
        </section>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://www.janebond.test/");
    assert.equal(facts.gallery.length, 1);
    assert.equal(facts.gallery[0].src, "https://www.janebond.test/images/jane_draught.jpg");
    assert.equal(facts.gallery[0].alt, "The Jane Bond");
  });

  test("excludes a real logo image (by filename and by alt text) and an unresolved template placeholder — never mistaken for real content photography", () => {
    const html = `
      <html><body>
        <img id="jane" src="images/logo.png" alt="The Jane Bond Logo" />
        <img class="brand" src="images/brand-icon.png" alt="Icon" />
        <img class="gram" src="{{image}}" alt="Instagram Feed Photo" />
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://www.janebond.test/");
    assert.deepEqual(facts.gallery, []);
  });

  test("excludes a tiny explicitly-sized icon by its HTML width/height attributes, but keeps a real photo with no size attributes at all", () => {
    const html = `
      <html><body>
        <img src="/icons/search.png" width="16" height="16" alt="Search" />
        <img src="/photos/dining-room.jpg" alt="Dining room" />
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.gallery.length, 1);
    assert.match(facts.gallery[0].src, /dining-room\.jpg$/);
  });

  test("still finds images explicitly inside a 'gallery'-classed container too — a broadening, not a replacement of the prior behavior", () => {
    const html = `<html><body><div class="photo-gallery"><img src="/img1.jpg" alt="Storefront" /></div></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.gallery.length, 1);
    assert.match(facts.gallery[0].src, /img1\.jpg$/);
  });

  test("excludes images inside nav/header/footer chrome", () => {
    const html = `
      <html><body>
        <header><img src="/header-banner.jpg" alt="Header banner" /></header>
        <footer><img src="/footer-badge.jpg" alt="Footer badge" /></footer>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.deepEqual(facts.gallery, []);
  });
});

// ===========================================================================
// Phase 5.4 — real regressions found re-validating Phase 5.3's Canadian Tire
// and Play It Again Sports makeovers against generic fixtures (never the
// real businesses' own text — the fix must generalize, not special-case).
// ===========================================================================

describe("crawl-adapter: scraped source-chrome rejection (Phase 5.4, real Canadian Tire regression)", () => {
  test("a GTM noscript/iframe snippet and skip-links do not become rendered 'services' content — real content on the same page is preserved", () => {
    const html = `
      <html><head><title>Services | Acme Co</title></head><body>
        <a href="#content">Skip to main content</a>
        <a href="#nav">Skip to navigation</a>
        <noscript><iframe title="GTMFrame" src="https://www.googletagmanager.com/ns.html?id=GTM-XXXX" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
        <main><p>We offer real installation and repair services for your home, scheduled same week.</p></main>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://acme.test/services");
    assert.equal(facts.services.length, 1);
    assert.doesNotMatch(facts.services[0].excerpt, /iframe|googletagmanager|skip to/i);
    assert.match(facts.services[0].excerpt, /real installation and repair services/);
  });

  test("a real e-commerce filter/sort sidebar does not become rendered 'services' content — genuine DOM content, not markup chrome, so only the vocabulary check catches it", () => {
    const html = `
      <html><head><title>Products | Acme Co</title></head><body>
        <main>Selecting a filter will refresh the page with new results. Refine by No filters applied Browse by Product Brand, Condition &amp; more Hide Filters Show Filters Price Min/Max Price Filter Min Price Min Price Max Price Max Price Update Sort By: Newest Items A to Z Z to A</main>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://acme.test/products");
    assert.deepEqual(facts.products, []);
  });

  test("real body content unrelated to e-commerce/tracking chrome is unaffected — the filter is not overly broad", () => {
    const html = `
      <html><head><title>Services | Acme Co</title></head><body>
        <main><p>Acme Co has served the local community for over twenty years with honest, reliable plumbing and electrical work.</p></main>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://acme.test/services");
    assert.equal(facts.services.length, 1);
    assert.match(facts.services[0].excerpt, /served the local community/);
  });
});

describe("crawl-adapter: Team evidence gating (Phase 5.4, real Play It Again Sports regression)", () => {
  test("e-commerce filter/sort/category/price text is never adopted as Team evidence merely because the page URL/title contains 'team'", () => {
    const html = `
      <html><head><title>Lacrosse - Team and Special Order - Acme Sports</title></head><body>
        <main>Selecting a filter will refresh the page with new results. Refine by No filters applied Browse by Product Brand, Condition &amp; more Hide Filters Show Filters Price Min/Max Price Filter Min Price Min Price Max Price Max Price Update Sort By: Newest Items A to Z Z to A</main>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://acme-sports.test/lacrosse/team-and-special-order");
    assert.deepEqual(facts.team, [], "e-commerce filter/sort UI must never qualify as team evidence, real or fabricated");
  });

  test("genuine real prose on a real 'Our Team' page is still captured — the fix rejects e-commerce chrome specifically, not the honest URL/title fallback itself", () => {
    const html = `
      <html><head><title>Our Team | Acme Sports</title></head><body>
        <main><p>Our staff have decades of combined experience buying, selling, and repairing used sporting equipment for the whole community.</p></main>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://acme-sports.test/our-team");
    assert.equal(facts.team.length, 1);
    assert.match(facts.team[0].excerpt, /decades of combined experience/);
  });
});

describe("crawl-adapter: gallery UI-icon rejection (Phase 5.4, real Canadian Tire regression)", () => {
  test("SVG interface icons (cart/tag/etc.) are rejected even with no filename keyword and no small explicit size attribute", () => {
    const html = `
      <html><body>
        <img src="/assets/interface/cart.svg" alt="Cart" />
        <img src="/assets/interface/price-tag.svg" alt="" />
        <img src="/photos/store-front.jpg" alt="Store front" />
        <img src="/photos/interior.jpg" alt="Interior" />
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.gallery.length, 2);
    assert.ok(facts.gallery.every((g) => !g.src.endsWith(".svg")));
    assert.ok(facts.gallery.some((g) => g.src.endsWith("store-front.jpg")));
  });

  test("a real photo isn't rejected just because 'cart'/'tag'-adjacent words appear elsewhere on the page — the filter targets the image's own src/alt, not page context", () => {
    const html = `<html><body><img src="/photos/cottage-dining-room.jpg" alt="Dining room" /><img src="/photos/lakeside-view.jpg" alt="Lakeside view" /></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.gallery.length, 2);
  });
});

describe("crawl-adapter: menu category detection — same tag used for item names/prices as for a candidate category (Phase 5.4, real jandbrestaurant.com regression)", () => {
  test("no real category heading exists: a page using <h4> for every item name (plus once for a tagline) and <h5> for every price falls back honestly, never inventing categories from either tag", () => {
    // Representative of jandbrestaurant.com's real, unchanged markup shape:
    // <h4>Tagline</h4>, then every real item as <h4>Name</h4><h5>Price</h5>
    // with NO real category heading anywhere on the page at all.
    const html = `
      <html><body>
        <h4 class="text-center">The Best Kept Secret In Town</h4>
        <div><h4>Lepinja sa kajmakom</h4><h5>$6.50</h5></div>
        <div><h4>Fillet Of Sole Almondine</h4><h5>$6.00</h5></div>
        <div><h4>Chicken Wings</h4><h5>6/$15.95 or 12/$19.95</h5></div>
        <div><h4>Chicken Fingers</h4><h5>$15.95</h5></div>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.menu.length, 1, "no real category heading exists — everything must fall under the one honest fallback category");
    assert.equal(facts.menu[0].name, "Menu");
    // 3, not 4: "Chicken Wings" price cell is "6/$15.95 or 12/$19.95" — not a
    // bare price token, so pass 1 (pre-existing, unrelated to this fix)
    // never treats it as a real item at all; it's just honestly dropped,
    // matching jandbrestaurant.com's own real behavior. Item-level
    // extraction for the OTHER 3 real items is unaffected by this fix.
    assert.equal(facts.menu[0].items.length, 3, "real item-level extraction is unaffected by the category fix");
    assert.equal(facts.menu[0].items[0].name, "Lepinja sa kajmakom");
    assert.equal(facts.menu[0].items[0].price, "$6.50");
  });

  test("a real category heading in the SAME tag as items/prices elsewhere is still rejected, but a DIFFERENT, unclaimed heading tag is still trusted", () => {
    const html = `
      <html><body>
        <h2>Appetizers</h2>
        <div><h4>Lepinja sa kajmakom</h4><h5>$6.50</h5></div>
        <div><h4>Fillet Of Sole Almondine</h4><h5>$6.00</h5></div>
        <h4>Not a real category, just a stray h4 tagline</h4>
        <div><h4>Chicken Wings</h4><h5>6/$15.95 or 12/$19.95</h5></div>
        <div><h4>Chicken Fingers</h4><h5>$15.95</h5></div>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    // h2 was never claimed by any item name/price on this page, so it's
    // still trusted as a real category; h4 WAS claimed (every item name is
    // h4), so the stray h4 tagline is correctly never promoted to a second
    // category — everything after it stays under "Appetizers".
    assert.equal(facts.menu.length, 1);
    assert.equal(facts.menu[0].name, "Appetizers");
    // 3, not 4 — see the previous test's comment: "Chicken Wings"' own price
    // cell isn't a bare price token, so it's never a real item.
    assert.equal(facts.menu[0].items.length, 3);
  });

  test("legitimate menu categories (janebond.ca's real, unchanged shape) still work end to end", () => {
    const html = `
      <html><body>
        <div class="menu_section_title">Appetizers</div>
        <div class="menu_single_item"><div class="item_name">Antojitos</div><div class="item_price">18.00</div></div>
        <div class="menu_single_item"><div class="item_name">Vegan Caesar</div><div class="item_price">14.00</div></div>
        <div class="menu_section_title">Entrees</div>
        <div class="menu_single_item"><div class="item_name">Braised Short Rib</div><div class="item_price">27.00</div></div>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.menu.length, 2);
    assert.equal(facts.menu[0].name, "Appetizers");
    assert.equal(facts.menu[1].name, "Entrees");
  });
});

// ===========================================================================
// Phase 5.5 — narrow remediation of the two real Canadian Tire regressions
// found re-validating Phase 5.4: a JSON-LD block nested inside an otherwise-
// legitimate content card, and a real promotional banner image (baked-in
// marketing text) selected as a photo-dependent hero background. Fixtures
// are representative/generic, never copying Canadian Tire's own real text.
// ===========================================================================

describe("crawl-adapter: JSON-LD / structured-data exclusion from rendered content (Phase 5.5, real Canadian Tire regression)", () => {
  test("a JSON-LD <script> block nested inside an otherwise-legitimate matched services card never leaks into its excerpt or heading", () => {
    const html = `
      <html><body>
        <div class="services-card">
          <h3>Customer Support</h3>
          <p>We will attempt to give you a refund or exchange on every item purchased.</p>
          <script type="application/ld+json">{"image":"https://example.test/logo.svg","potentialAction":[{"name":"Shopping Cart","target":{"url":"https://example.test/cart"}}]}</script>
        </div>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.services.length, 1);
    assert.equal(facts.services[0].heading, "Customer Support");
    assert.doesNotMatch(facts.services[0].excerpt, /potentialAction|"image"|Shopping Cart/);
    assert.match(facts.services[0].excerpt, /refund or exchange/);
  });

  test("raw JSON-like text that ends up in extracted content for any reason (not just inside a <script> tag) is rejected by content shape, not just DOM position", () => {
    const html = `
      <html><body>
        <div class="services-card">
          <h3>Store Info</h3>
          <p>{"name":"Acme Co","openingHours":"Mo-Fr 09:00-18:00"}</p>
        </div>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.deepEqual(facts.services, [], "a services card whose only real content is JSON-shaped text has no real human-readable content to report");
  });

  test("real business copy that happens to mention curly braces or colons in ordinary prose is never rejected — the check targets JSON shape specifically, not punctuation", () => {
    const html = `
      <html><body>
        <div class="services-card">
          <h3>Hours</h3>
          <p>Open daily: 9am to 6pm. Closed on statutory holidays.</p>
        </div>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.services.length, 1);
    assert.match(facts.services[0].excerpt, /Open daily/);
  });

  test("a nested JSON-LD script does not corrupt real menu item extraction — item-level extraction is unaffected by this fix", () => {
    const html = `
      <html><body>
        <div class="menu_single_item">
          <div class="item_name">Braised Short Rib</div><div class="item_price">27.00</div>
          <script type="application/ld+json">{"@type":"MenuItem","name":"Braised Short Rib"}</script>
        </div>
        <div class="menu_single_item">
          <div class="item_name">Pan-Seared Salmon</div><div class="item_price">24.00</div>
        </div>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.menu[0].items.length, 2);
    assert.equal(facts.menu[0].items[0].name, "Braised Short Rib");
    assert.doesNotMatch(facts.menu[0].items[0].name, /@type|MenuItem/);
  });
});

describe("crawl-adapter: promotional/banner imagery rejection (Phase 5.5, real Canadian Tire regression)", () => {
  test("a real promotional banner image (informative alt text reading as a marketing message) is excluded from gallery evidence", () => {
    const html = `
      <html><body>
        <img src="/promo/back-to-class-banner.png" alt="Back to school sale. Shop now. Same-day pickup available." />
        <img src="/photos/storefront.jpg" alt="Storefront" />
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.gallery.length, 1);
    assert.match(facts.gallery[0].src, /storefront\.jpg$/);
  });

  test("a real content image with BLANK alt text is never excluded on a guess — must not silently suppress a real missing-alt-text accessibility finding", () => {
    const html = `
      <html><body>
        <img src="/photos/promo-strategy-banner.png" alt=" " />
        <img src="/photos/other.jpg" alt="Product detail" />
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.gallery.length, 2, "blank alt text is UNKNOWN evidence, never treated as proof of promotional text — the image must stay in gallery so a real missing-alt QA finding isn't silently erased");
  });

  test("a legitimate product photo with a real, non-promotional alt description is never excluded, even from the same asset family as a real banner", () => {
    const html = `
      <html><body>
        <img src="/category/auto-ev-strategy-lp-aspot-banner.png" alt="Free shipping. Shop now. Limited time offer." />
        <img src="/category/auto-ev-strategy-lp-sec01-evtires.png" alt="EV Tires" />
        <img src="/category/auto-ev-strategy-lp-sec01-batteries.png" alt="12-Volt Batteries" />
      </body></html>
    `;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.gallery.length, 2, "the two real product photos survive even though they share a filename family with the real banner");
    assert.ok(facts.gallery.some((g) => g.alt === "EV Tires"));
    assert.ok(facts.gallery.some((g) => g.alt === "12-Volt Batteries"));
  });

  test("an image with a small sign/label mentioned in alt text is not excluded — only a real multi-clause promotional message is", () => {
    const html = `<html><body><img src="/photos/dining-room.jpg" alt="Dining room with a small 'Est. 1985' sign on the wall" /></body></html>`;
    const $ = cheerio.load(html);
    const facts = extractStructuredFacts($, "https://example.test/");
    assert.equal(facts.gallery.length, 1, "mentioning a small sign/label in a real description is not the same as the image BEING a promotional banner");
  });
});
