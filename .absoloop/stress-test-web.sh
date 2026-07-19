#!/bin/zsh
# Iteration-3 flake characterization: repeat the full web suite and capture any failure.
cd /Users/rohnspringfield/weekform-dev || exit 1
fails=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  echo "=== run $i ==="
  out=$(npm run test:web 2>&1)
  echo "$out" | grep -E "(tests|pass|fail) [0-9]+"
  if echo "$out" | grep -qE "fail [1-9]"; then
    fails=$((fails+1))
    echo "$out" > /Users/rohnspringfield/weekform-dev/.absoloop/stress-fail-run-$i.log
    echo "FAILURE captured to .absoloop/stress-fail-run-$i.log"
  fi
done
echo "=== total failing runs: $fails / 12 ==="
