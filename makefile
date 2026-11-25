build:
	@echo ⌛ building...
	yarn run build
	@echo done

codegen:
	@echo ⌛ generating...
	yarn run codegen
	@echo done

install:
	@echo ⌛ installing...
	yarn
	@echo done

lint:
	@echo ⌛ linting...
	yarn run lint
	@echo done

run:
	@echo ⌛ running development...
	yarn run development

run.production:
	@echo ⌛ running production...
	yarn run production

start:
	@echo ⌛ starting...
	yarn install && yarn run start
	@echo ✅ done

# A new Ed25519 key for JWT_SIGNING_KEY, printed as PKCS#8 PEM. Pipe it into
# Secret Manager rather than the terminal: make jwt.key | gcloud secrets versions add jwt-signing-key --data-file=-
jwt.key:
	@node -e "process.stdout.write(require('node:crypto').generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }))"

# Portfolio access: make portfolio.grant PIECE=moonshot EMAIL=someone@example.com
# MONGODB_DATABASE=production picks the production database.
portfolio.grant:
	@npx tsx Server/Scripts/portfolioAccess.ts grant "$(PIECE)" "$(EMAIL)"

portfolio.revoke:
	@npx tsx Server/Scripts/portfolioAccess.ts revoke "$(PIECE)" "$(EMAIL)"

portfolio.list:
	@npx tsx Server/Scripts/portfolioAccess.ts list "$(PIECE)"

# One naming for the database: snake_case plural collections and camelCase
# fields. Safe to run again. MONGODB_DATABASE picks the database.
mongo.naming:
	@npx tsx Server/Scripts/naming.ts

# Kinetic Light songs: make kinetic-light.migrate brings every song to the
# current shape, then make kinetic-light.examples IDS="<id> <id>" makes songs
# examples every visitor can play. MONGODB_DATABASE picks the database.
kinetic-light.migrate:
	@npx tsx Server/Scripts/kineticLight.ts migrate

kinetic-light.examples:
	@npx tsx Server/Scripts/kineticLight.ts examples $(IDS)

# Swatch: make swatch.examples HEXES="#1D88BD #2B0A12" makes up to five ready
# picked colours the examples every visitor sees first. MONGODB_DATABASE picks
# the database.
swatch.examples:
	@npx tsx Server/Scripts/swatch.ts examples $(foreach hex,$(HEXES),'$(hex)')

# make swatch.refilm IDS="<id> <id>" makes those swatches' films again, with
# their own sound; without IDS, every ready swatch. Each is one more paid film.
swatch.refilm:
	@npx tsx Server/Scripts/swatch.ts refilm $(IDS)

# make swatch.resound IDS="<id> <id>" cleans those films' sound again with the
# current settings, from Gemini's original, and keeps the picture. Nothing is
# paid for. Films made before originals were kept have to be made again.
swatch.resound:
	@npx tsx Server/Scripts/swatch.ts resound $(IDS)

# Contact form: make contact.forget EMAIL=someone@example.com
# Deletes every message kept under that address, for a deletion request.
contact.forget:
	@npx tsx Server/Scripts/contactMessages.ts forget "$(EMAIL)"

