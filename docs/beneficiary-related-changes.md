# Task List for Schema Update to Beneficiary Migration

This task list includes all files under /src that reference old schema elements and need to be reviewed and updated to match the new beneficiary schema.

---

## Sponsor People Table References (to be updated to beneficiaries)

- src/actions/index.tsx  
  Review all queries and mutations using "sponsor_people" table and update to "beneficiaries".  
  Update any types/interfaces using child_id or sponsor_people.

- src/app/api/webhooks/stripe/route.ts  
  Update all references to "sponsor_people" and "child_id" in queries and metadata.

- src/app/api/children/getByAgeAndGender/route.ts  
  Update "sponsor_people" references.

- src/app/api/admin/children/update/route.ts  
  Update "sponsor_people" references and child_id columns.

- src/app/api/admin/children/delete/route.ts  
  Update "sponsor_people" references and child_id columns.

- src/app/api/children/get/route.ts  
  Update "sponsor_people" references.

- src/app/api/admin/children/bulk-upload/route.ts  
  Update "sponsor_people" references.

- src/app/api/admin/children/create/route.ts  
  Update "sponsor_people" references.

- src/app/api/children/get/[id]/route.ts  
  Update "sponsor_people" references.

- src/app/api/children/get/username/[username]/route.ts  
  Update "sponsor_people" references.

- src/app/api/admin/children/retrieve/route.ts  
  Update "sponsor_people" references.

- src/app/api/admin/children/bulk-delete/route.ts  
  Update "sponsor_people" references.

- src/app/(admin)/admin/children/page.tsx  
  Update any storage or queries referencing "sponsor_people".

- src/app/(admin)/admin/children/components/EditDrawer.tsx  
  Update storage and queries referencing "sponsor_people".

- src/app/(app)/app/page.tsx  
  Update "sponsor_people" references.

---

## Sponsor People Images Table References (to be updated to media)

- src/app/api/admin/children/images/delete/route.ts  
  Update "sponsor_people_images" references.

- src/app/api/admin/children/images/[id]/route.ts  
  Update "sponsor_people_images" references.

- src/app/api/admin/children/images/create/route.ts  
  Update "sponsor_people_images" references.

- src/app/api/admin/children/bulk-delete/route.ts  
  Update "sponsor_people_images" references.

- src/app/api/admin/children/delete/route.ts  
  Update "sponsor_people_images" references.

- src/app/(admin)/admin/children/components/EditDrawer.tsx  
  Update "sponsor_people_images" references.

---

## Child ID Column References (to be updated to beneficiary_id)

- src/actions/index.tsx  
  Update all queries and mutations using "child_id" column.

- src/types/index.ts  
  Update types/interfaces using "child_id".

- src/app/(app)/app/columns.tsx  
  Update "child_id" references.

- src/app/api/webhooks/stripe/route.ts  
  Update "child_id" references.

- src/app/api/admin/children/create/route.ts  
  Update "child_id" references.

- src/app/api/admin/children/delete/route.ts  
  Update "child_id" references.

- src/app/api/admin/children/bulk-delete/route.ts  
  Update "child_id" references.

---

## Subscriptions Table References

- src/actions/index.tsx  
  Review and update queries/mutations on "subscriptions" table.

- src/app/sponsor-a-child/components/SponsorshipDetails/index.tsx  
  Review subscription data usage.

- src/app/(app)/app/page.tsx  
  Review subscription data usage.

- src/app/api/webhooks/stripe/route.ts  
  Review and update "subscriptions" table usage.

- src/app/api/admin/children/delete/route.ts  
  Review "subscriptions" table usage.

- src/app/api/admin/children/bulk-delete/route.ts  
  Review "subscriptions" table usage.

- src/app/api/stripe/cancel-subscription/route.ts  
  Review subscription cancellation logic.

- src/app/api/stripe/session/route.ts  
  Review subscription session logic.

---

## People Activities Table References (to be updated to activities)

- src/actions/index.tsx  
  Update "people_activities" references.

- src/app/api/webhooks/stripe/route.ts  
  Update "people_activities" references.

- src/app/api/admin/children/delete/route.ts  
  Update "people_activities" references.

- src/app/api/admin/children/create/route.ts  
  Update "people_activities" references.

- src/app/api/admin/children/bulk-delete/route.ts  
  Update "people_activities" references.

---

## Activities Table References

- src/actions/index.tsx  
  Update "activities" references.

- src/app/sponsor-a-child/components/ChildActivity/index.tsx  
  Review and update activities usage.

---

## Files and Directories to Rename

- Rename directories and files from "children" to "beneficiaries" in the following paths:  
  - src/app/api/children → src/app/api/beneficiaries  
  - src/app/api/admin/children → src/app/api/admin/beneficiaries  
  - src/app/(admin)/admin/children → src/app/(admin)/admin/beneficiaries

---

# Next Steps

- Review and update each file in this list to replace old table names and columns with the new schema.
- Rename directories and files as noted.
- Update types/interfaces accordingly.
- Test each area thoroughly after changes.

This task list will help track progress and ensure all affected files are addressed.