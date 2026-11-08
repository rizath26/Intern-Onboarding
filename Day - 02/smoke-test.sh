#!/usr/bin/env bash
# BookSwap mock smoke test. Start the mock first:
#   npx @stoplight/prism-cli@5.14.2 mock openapi/bookswap-openapi.yaml --port 4010
# Then, from the repository root:
#   bash reports/smoke-test.sh
set -u
BASE="${BASE:-http://127.0.0.1:4010}"
OWNER="Authorization: Bearer owner-test-token"
BORROWER="Authorization: Bearer borrower-test-token"
JSON="Content-Type: application/json"
pass=0; total=0

check () { # $1=#  $2=label  $3=expected (space-separated alternatives)  $4=actual
  total=$((total+1))
  if [[ " $3 " == *" $4 "* ]]; then pass=$((pass+1)); r=PASS; else r=FAIL; fi
  printf "%-2s %-48s expected %-9s actual %-4s %s\n" "$1" "$2" "$3" "$4" "$r"
}

s=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/books?page=1&pageSize=20" -H "$OWNER")
check 1 "GET  /books?page=1&pageSize=20" "200" "$s"

s=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/books" -H "$OWNER" -H "$JSON" \
  -d '{"title":"Ponniyin Selvan","author":"Kalki Krishnamurthy","isbn":"9788184930801","condition":"good"}')
check 2 "POST /books (valid payload)" "201" "$s"

s=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/books" -H "$OWNER" -H "$JSON" \
  -d '{"author":"Kalki Krishnamurthy","condition":"good"}')
check 3 "POST /books (missing title)" "400 422" "$s"

s=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/books/999/borrow-requests" -H "$BORROWER" -H "$JSON" \
  -H "Idempotency-Key: 3f6c2a9e-1b7d-4e2a-9c11-5d8e0f7a2b44" -d '{"message":"Can I borrow it this weekend?"}')
check 4 "POST /books/999/borrow-requests (borrower JWT)" "201" "$s"

s=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/books")
check 5 "GET  /books (no Authorization header)" "401" "$s"

echo "----"
echo "$pass/$total passing"
[[ $pass -eq $total ]]
