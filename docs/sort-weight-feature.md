# Sort Weight Feature

## Overview
The sort weight feature automatically adjusts the display priority of beneficiaries based on daily sponsorship activity. When more than 25 children have been sponsored in a single day, newly sponsored children receive a lower sort weight, pushing them lower in the list to give more visibility to children who haven't been sponsored yet.

## How It Works

### Database Schema
- **Column**: `beneficiaries.sort_weight` (integer, default: 100)
- **Index**: `idx_beneficiaries_sort_weight` for optimized sorting

### Sort Weight Values
- **100**: Normal priority (default)
- **50**: Reduced priority (applied when >25 children sponsored in a day)

### Automatic Adjustment
When a beneficiary's sponsorship goal is fulfilled (`goal_fulfilled_at` is set):

1. The system counts how many beneficiaries have been fulfilled today
2. If count > 25:
   - New fulfillment gets `sort_weight = 50` (lower priority)
3. If count ≤ 25:
   - New fulfillment keeps `sort_weight = 100` (normal priority)

### Sorting Logic
Beneficiaries are sorted by:
1. `sort_weight` DESC (higher weight = higher priority)
2. `created_at` DESC (newer first within same weight)
3. `id` DESC (stable tiebreaker)

## Implementation Details

### Database Trigger
**Trigger**: `trigger_adjust_sort_weight`
- **Fires**: BEFORE UPDATE on `beneficiaries` table
- **Function**: `adjust_sort_weight_on_fulfillment()`
- **Logic**: Automatically sets sort_weight based on daily fulfillment count

### Helper Function
**Function**: `get_today_fulfilled_count()`
- Returns count of beneficiaries with `goal_fulfilled_at` on current day (UTC)

### API Integration
The `/api/beneficiaries/get` endpoint now sorts by `sort_weight` first:

```typescript
query = query
  .order("sort_weight", { ascending: false })
  .order("created_at", { ascending: false })
  .order("id", { ascending: false })
  .limit(limit)
```

## Migration
**File**: `supabase/migrations/20251108150000_add_sort_weight.sql`

To apply the migration:
```bash
# Using Supabase CLI
supabase db push

# Or apply manually via Supabase Dashboard > SQL Editor
```

## Benefits

1. **Fair Distribution**: Prevents one day's successful sponsorships from dominating the list
2. **Visibility**: Ensures children waiting for sponsorship remain visible
3. **Automatic**: No manual intervention required
4. **Transparent**: Based on clear, objective criteria (daily count threshold)

## Examples

### Scenario 1: Normal Day (< 25 sponsorships)
- Child A sponsored at 10:00 AM → sort_weight = 100
- Child B sponsored at 11:00 AM → sort_weight = 100
- Child C sponsored at 2:00 PM → sort_weight = 100
- All appear in normal order (by created_at)

### Scenario 2: High Activity Day (> 25 sponsorships)
- Children 1-25 sponsored → each gets sort_weight = 100
- Child 26 sponsored → sort_weight = 50 (moved lower in list)
- Child 27 sponsored → sort_weight = 50 (moved lower in list)
- Children 1-25 appear higher, children 26-27 appear lower

## Monitoring

Check daily sponsorship count:
```sql
SELECT get_today_fulfilled_count();
```

View beneficiaries with reduced weight:
```sql
SELECT id, name, goal_fulfilled_at, sort_weight
FROM beneficiaries
WHERE sort_weight < 100
ORDER BY goal_fulfilled_at DESC;
```

## Future Enhancements

Possible improvements:
- Make threshold (25) configurable via environment variable
- Add time-based weight decay (reduce weight over time)
- Implement different weight tiers (100, 75, 50, 25)
- Add admin interface to manually adjust sort weights
