SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;
-- Edit: This was assumed to be needed but does not seem to be used, and causes migration errors
-- CREATE EXTENSION IF NOT EXISTS "pgsodium" WITH SCHEMA "pgsodium";
COMMENT ON SCHEMA "public" IS 'standard public schema';
CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "pgjwt" WITH SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";

CREATE TYPE "public"."PersonStatus" AS ENUM (
    'New',
    'Partially Funded',
    'Budget Fulfilled',
    'Archived'
);
ALTER TYPE "public"."PersonStatus" OWNER TO "postgres";
COMMENT ON TYPE "public"."PersonStatus" IS 'Possible Status types for the People table';
SET default_tablespace = '';
SET default_table_access_method = "heap";
CREATE TABLE IF NOT EXISTS "public"."advocate" (
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL
);
ALTER TABLE "public"."advocate" OWNER TO "postgres";
COMMENT ON TABLE "public"."advocate" IS 'Celebrities/social influencers/etc who promote charitable organizations and projects';
CREATE TABLE IF NOT EXISTS "public"."initiative" (
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid"
);
ALTER TABLE "public"."initiative" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."organization" (
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL
);
ALTER TABLE "public"."organization" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."people" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "name" "text",
    "birth_date" "date",
    "biography" "text",
    "budget_goal" integer DEFAULT 0,
    "budget_raised" integer DEFAULT 0,
    "status" "public"."PersonStatus" DEFAULT 'New'::"public"."PersonStatus",
    "country" "text"
);
ALTER TABLE "public"."people" OWNER TO "postgres";
COMMENT ON TABLE "public"."people" IS 'Collection of individuals funds are being raised for';
CREATE TABLE IF NOT EXISTS "public"."permission_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "role_id" "uuid",
    "permission_id" "uuid"
);
ALTER TABLE "public"."permission_assignments" OWNER TO "postgres";
COMMENT ON TABLE "public"."permission_assignments" IS 'Lookuptable to assign permissions to roles';
CREATE TABLE IF NOT EXISTS "public"."permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text"
);
ALTER TABLE "public"."permissions" OWNER TO "postgres";
COMMENT ON TABLE "public"."permissions" IS 'Individual permissions able to be assigned to specific roles';
CREATE TABLE IF NOT EXISTS "public"."project" (
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "initiative_id" "uuid"
);
ALTER TABLE "public"."project" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."role_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "organization_id" "uuid",
    "advocate_id" "uuid" DEFAULT "gen_random_uuid"(),
    "user_id" "uuid" NOT NULL,
    "role_id" "uuid"
);
ALTER TABLE "public"."role_assignments" OWNER TO "postgres";
COMMENT ON TABLE "public"."role_assignments" IS 'Assigns roles to users globally or within specific org/advocates';
CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text"
);
ALTER TABLE "public"."roles" OWNER TO "postgres";
COMMENT ON TABLE "public"."roles" IS 'User roles for permission management';
ALTER TABLE ONLY "public"."advocate"
    ADD CONSTRAINT "advocate_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."initiative"
    ADD CONSTRAINT "initiative_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."organization"
    ADD CONSTRAINT "organization_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."people"
    ADD CONSTRAINT "people_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."permission_assignments"
    ADD CONSTRAINT "permission_assignments_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."project"
    ADD CONSTRAINT "project_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."role_assignments"
    ADD CONSTRAINT "role_assignments_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."initiative"
    ADD CONSTRAINT "initiative_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."permission_assignments"
    ADD CONSTRAINT "permission_assignments_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."permission_assignments"
    ADD CONSTRAINT "permission_assignments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."project"
    ADD CONSTRAINT "project_initiative_id_fkey" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiative"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."role_assignments"
    ADD CONSTRAINT "role_assignments_advocate_id_fkey" FOREIGN KEY ("advocate_id") REFERENCES "public"."advocate"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."role_assignments"
    ADD CONSTRAINT "role_assignments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."role_assignments"
    ADD CONSTRAINT "role_assignments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."role_assignments"
    ADD CONSTRAINT "role_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
CREATE POLICY "Enable read access for all users" ON "public"."advocate" FOR SELECT USING (true);
CREATE POLICY "Enable read access for all users" ON "public"."initiative" FOR SELECT USING (true);
CREATE POLICY "Enable read access for all users" ON "public"."organization" FOR SELECT USING (true);
CREATE POLICY "Enable read access for all users" ON "public"."people" FOR SELECT USING (true);
CREATE POLICY "Enable read access for all users" ON "public"."project" FOR SELECT USING (true);
CREATE POLICY "Enable select for authenticated users only" ON "public"."permission_assignments" FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "Enable select for authenticated users only" ON "public"."permissions" FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "Enable select for authenticated users only" ON "public"."role_assignments" FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "Enable select for authenticated users only" ON "public"."roles" FOR SELECT TO "authenticated" USING (true);
ALTER TABLE "public"."advocate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."initiative" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."people" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."permission_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."project" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."role_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;

ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";
ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."organization";
GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
GRANT ALL ON TABLE "public"."advocate" TO "anon";
GRANT ALL ON TABLE "public"."advocate" TO "authenticated";
GRANT ALL ON TABLE "public"."advocate" TO "service_role";
GRANT ALL ON TABLE "public"."initiative" TO "anon";
GRANT ALL ON TABLE "public"."initiative" TO "authenticated";
GRANT ALL ON TABLE "public"."initiative" TO "service_role";
GRANT ALL ON TABLE "public"."organization" TO "anon";
GRANT ALL ON TABLE "public"."organization" TO "authenticated";
GRANT ALL ON TABLE "public"."organization" TO "service_role";
GRANT ALL ON TABLE "public"."people" TO "anon";
GRANT ALL ON TABLE "public"."people" TO "authenticated";
GRANT ALL ON TABLE "public"."people" TO "service_role";
GRANT ALL ON TABLE "public"."permission_assignments" TO "anon";
GRANT ALL ON TABLE "public"."permission_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."permission_assignments" TO "service_role";
GRANT ALL ON TABLE "public"."permissions" TO "anon";
GRANT ALL ON TABLE "public"."permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."permissions" TO "service_role";
GRANT ALL ON TABLE "public"."project" TO "anon";
GRANT ALL ON TABLE "public"."project" TO "authenticated";
GRANT ALL ON TABLE "public"."project" TO "service_role";
GRANT ALL ON TABLE "public"."role_assignments" TO "anon";
GRANT ALL ON TABLE "public"."role_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."role_assignments" TO "service_role";
GRANT ALL ON TABLE "public"."roles" TO "anon";
GRANT ALL ON TABLE "public"."roles" TO "authenticated";
GRANT ALL ON TABLE "public"."roles" TO "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "service_role";

RESET ALL;