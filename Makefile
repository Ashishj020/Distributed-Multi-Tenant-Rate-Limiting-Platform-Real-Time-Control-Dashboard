.PHONY: up down logs test load-test benchmark

up:
	docker compose up --build

down:
	docker compose down

logs:
	docker compose logs -f rate-limiter

test:
	docker compose up -d redis
	docker compose --profile test run --rm tests

load-test:
	cd load-test && npm install && node autocannon.js --tenants 50 --duration 30 --rate 4000 --url http://127.0.0.1:3008

benchmark:
	cd load-test && node benchmark.mjs
