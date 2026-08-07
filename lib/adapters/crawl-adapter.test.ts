import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as cheerio from "cheerio";

import { extractStructuredFacts } from "@/lib/adapters/crawl-adapter";

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
  const facts = extractStructuredFacts($);

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
  const facts = extractStructuredFacts($);

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

describe("crawl-adapter: extractStructuredFacts (no structured content at all)", () => {
  test("returns honest empty defaults, never a guessed value", () => {
    const $ = cheerio.load(EMPTY_HTML);
    const facts = extractStructuredFacts($);

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
