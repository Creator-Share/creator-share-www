BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(4);

WITH inserted AS (
  INSERT INTO public.advocates (slug, display_name)
  VALUES ('brandingboundary', 'Branding Boundary')
  RETURNING id
)
INSERT INTO public.advocate_branding (
  advocate_id,
  opening_header_html,
  about_biography_html
)
SELECT id, repeat('a', 16384), repeat('b', 16384)
FROM inserted;

SELECT extensions.is(
  octet_length(opening_header_html),
  16384,
  'the opening header accepts exactly 16 KiB'
)
FROM public.advocate_branding
WHERE advocate_id = (
  SELECT id
  FROM public.advocates
  WHERE slug = 'brandingboundary'
);

SELECT extensions.is(
  octet_length(about_biography_html),
  16384,
  'the About biography accepts exactly 16 KiB'
)
FROM public.advocate_branding
WHERE advocate_id = (
  SELECT id
  FROM public.advocates
  WHERE slug = 'brandingboundary'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.advocate_branding
    SET opening_header_html = repeat('a', 16385)
    WHERE advocate_id = (
      SELECT id
      FROM public.advocates
      WHERE slug = 'brandingboundary'
    )
  $$,
  '23514',
  'new row for relation "advocate_branding" violates check constraint "advocate_branding_opening_header_size_check"',
  'the opening header rejects content over 16 KiB'
);

SELECT extensions.throws_ok(
  $$
    UPDATE public.advocate_branding
    SET about_biography_html = repeat('b', 16385)
    WHERE advocate_id = (
      SELECT id
      FROM public.advocates
      WHERE slug = 'brandingboundary'
    )
  $$,
  '23514',
  'new row for relation "advocate_branding" violates check constraint "advocate_branding_about_size_check"',
  'the About biography rejects content over 16 KiB'
);

SELECT * FROM extensions.finish();

ROLLBACK;
