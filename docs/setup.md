# Supabase Database Setup Instructions

## Enabling Required Extensions

Before deploying your database schema or running migrations, you need to enable certain PostgreSQL extensions that your project depends on.

### How to Enable Extensions in Supabase Dashboard

1. Log in to your [Supabase Dashboard](https://app.supabase.com/).
2. Select your project from the list.
3. In the left sidebar, click on **Database**.
4. Under the Database section, click on **Extensions**.
5. In the Extensions page, enable the following extensions if they are not already enabled:
   - `pgsodium`
   - `pg_graphql`
   - `pg_stat_statements`
   - `pgcrypto`
   - `pgjwt`
   - `supabase_vault`
   - `uuid-ossp`
6. Click the **Enable** button next to each extension to enable it for your database.

### Important Notes

- Extensions must be enabled before running migrations or pushing schema changes that depend on them.
- In managed Supabase environments, enabling via the dashboard GUI is the recommended approach.

## Deploying Your Schema

After enabling the required extensions, you can deploy your schema using one of the following methods:

- Use the Supabase CLI command to push your local schema changes without resetting the database:
  ```
  yarn supabase db push
  ```
- Or run your migrations in order:
  ```
  yarn supabase db migrate
  ```

These methods avoid ownership and permission issues that can occur with `db reset`.

---

Following these steps will help ensure your database is correctly set up and ready for production use.
