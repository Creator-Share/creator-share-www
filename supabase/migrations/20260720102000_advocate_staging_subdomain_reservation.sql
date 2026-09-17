BEGIN;

LOCK TABLE public.advocates IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.advocate_domains IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.advocate_reserved_subdomains IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger trigger_definition
    WHERE trigger_definition.tgrelid =
      'public.advocate_reserved_subdomains'::regclass
      AND trigger_definition.tgname =
        'advocate_reserved_subdomains_immutable'
      AND NOT trigger_definition.tgisinternal
      AND trigger_definition.tgenabled = 'O'
      AND trigger_definition.tgfoid =
        'private.prevent_advocate_dictionary_mutation()'::regprocedure
  ) THEN
    RAISE EXCEPTION 'Reserved subdomain immutability trigger is unavailable'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.advocates advocate
    WHERE advocate.slug = 'advocate-staging'
  ) OR EXISTS (
    SELECT 1
    FROM public.advocate_domains domain
    WHERE domain.hostname = 'advocate-staging.creatorshare.com'
  ) THEN
    RAISE EXCEPTION 'Advocate staging hostname is already tenant assigned'
      USING ERRCODE = '23505';
  END IF;
END;
$$;

DROP TRIGGER advocate_reserved_subdomains_immutable
  ON public.advocate_reserved_subdomains;

INSERT INTO public.advocate_reserved_subdomains (label, reason)
VALUES (
  'advocate-staging',
  'Reserved for the isolated Creator Share advocate staging tenant root.'
)
ON CONFLICT (label) DO NOTHING;

CREATE TRIGGER advocate_reserved_subdomains_immutable
BEFORE INSERT OR UPDATE OR DELETE ON public.advocate_reserved_subdomains
FOR EACH ROW
EXECUTE FUNCTION private.prevent_advocate_dictionary_mutation();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.advocate_reserved_subdomains reserved
    WHERE reserved.label = 'advocate-staging'
      AND reserved.reason =
        'Reserved for the isolated Creator Share advocate staging tenant root.'
  ) THEN
    RAISE EXCEPTION 'Advocate staging reservation was not installed'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.advocates advocate
    WHERE advocate.slug = 'advocate-staging'
  ) OR EXISTS (
    SELECT 1
    FROM public.advocate_domains domain
    WHERE domain.hostname = 'advocate-staging.creatorshare.com'
  ) THEN
    RAISE EXCEPTION 'Advocate staging hostname became tenant assigned'
      USING ERRCODE = '23505';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger trigger_definition
    WHERE trigger_definition.tgrelid =
      'public.advocate_reserved_subdomains'::regclass
      AND trigger_definition.tgname =
        'advocate_reserved_subdomains_immutable'
      AND NOT trigger_definition.tgisinternal
      AND trigger_definition.tgenabled = 'O'
      AND trigger_definition.tgfoid =
        'private.prevent_advocate_dictionary_mutation()'::regprocedure
  ) THEN
    RAISE EXCEPTION 'Reserved subdomain immutability trigger was not restored'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

COMMIT;
