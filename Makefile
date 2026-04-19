SHELL := /bin/bash
.DELETE_ON_ERROR:
.SUFFIXES:

ifneq (,$(wildcard .env))
include .env
endif

export DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD SCP_HOST JOD_REMOTE_DIR

# -----------------------------------------------------------------------------
# layout
# -----------------------------------------------------------------------------

OUT_ROOT       := out
STAMP_ROOT     := stamps
LOG_ROOT       := logs

STPJS_LANGS    := en es
STPJS_OUT      := $(OUT_ROOT)/stpjs
STPJS_STAMP    := $(STAMP_ROOT)/stpjs
STPJS_LOG      := $(LOG_ROOT)/stpjs
STPJS_TOOLS    := tools/stpjs

JOD_VOLUMES    := $(shell seq -f "%02g" 1 26)
JOD_XML_DIR    ?= jod
JOD_OUT        := $(OUT_ROOT)/jod
JOD_DB_DIR     := $(JOD_OUT)/db
JOD_DIV_DIR    := $(JOD_OUT)/div
JOD_PUBLISH    := $(JOD_OUT)/publish
JOD_STAMP      := $(STAMP_ROOT)/jod
JOD_LOG        := $(LOG_ROOT)/jod
JOD_TOOLS      := tools/jod
JOD_XSL        := $(JOD_TOOLS)/xsl
JOD_CITE_SHA   := $(JOD_STAMP)/citations.sha1
JOD_REMOTE_DIR ?= /var/www/jod/div
SCP_HOST       ?= swliddle@blondie.byu.edu

VERSE_STAMP    := $(STAMP_ROOT)/verse-sets
VERSE_LOG      := $(LOG_ROOT)/verse-sets
VERSE_TOOLS    := tools/verse-sets

GC_ERA_XML_DIR ?= gc-era
GC_ERA_OUT     := $(OUT_ROOT)/gc-era
GC_ERA_STAMP   := $(STAMP_ROOT)/gc-era
GC_ERA_LOG     := $(LOG_ROOT)/gc-era
GC_ERA_TOOLS   := tools/gc-era
GC_ERA_XML     := $(wildcard $(GC_ERA_XML_DIR)/talk*.xml)

# Number of parallel shards for gc-ensign / gc-ensign-es builds.
# Override with: make SHARDS=8 gc-ensign-build
SHARDS ?= 4

# awk snippet: given lo, hi, n shard count → print n lines of `lo-hi` ranges
# covering [lo..hi]. Exits cleanly if lo/hi empty (e.g. input dirs missing).
SHARD_AWK := 'BEGIN{if(lo==""||hi=="")exit; step=int((hi-lo+1)/n); if(step<1)step=1; for(i=0;i<n;i++){a=lo+i*step; if(a>hi)break; b=(i==n-1||a+step-1>hi)?hi:a+step-1; print a"-"b}}'

# Splits an add-citations log into:
#   add.but   — "but ====" lines (per-talk citation-mismatch warnings)
#   add.todo  — every other line (true errors, missed patterns, etc.)
# $1 = directory containing add-citations.log; outputs land in the same dir.
define split_but_todo
@grep 'but ====' $(1)/add-citations.log > $(1)/add.but || true
@grep -v 'but ====' $(1)/add-citations.log > $(1)/add.todo || true
endef

GC_ENSIGN_ORIG_DIR    ?= gc-ensign/orig
GC_ENSIGN_EDIT_DIR    ?= gc-ensign/edit
GC_ENSIGN_OUT         := $(OUT_ROOT)/gc-ensign
GC_ENSIGN_STAMP       := $(STAMP_ROOT)/gc-ensign
GC_ENSIGN_LOG         := $(LOG_ROOT)/gc-ensign
GC_ENSIGN_TOOLS       := tools/gc-ensign
GC_ENSIGN_INPUTS      := $(wildcard $(GC_ENSIGN_ORIG_DIR)/*) $(wildcard $(GC_ENSIGN_EDIT_DIR)/*)
GC_ENSIGN_ID_BOUNDS   := $(shell { ls $(GC_ENSIGN_ORIG_DIR) 2>/dev/null; ls $(GC_ENSIGN_EDIT_DIR) 2>/dev/null; } | grep -E '^[0-9]+$$' | sort -n | awk 'NR==1{lo=$$0} END{print lo, $$0}')
GC_ENSIGN_SHARDS      := $(shell awk -v lo='$(word 1,$(GC_ENSIGN_ID_BOUNDS))' -v hi='$(word 2,$(GC_ENSIGN_ID_BOUNDS))' -v n=$(SHARDS) $(SHARD_AWK))

GC_ENSIGN_ES_ORIG_DIR ?= gc-ensign-es/orig
GC_ENSIGN_ES_EDIT_DIR ?= gc-ensign-es/edit
GC_ENSIGN_ES_OUT      := $(OUT_ROOT)/gc-ensign-es
GC_ENSIGN_ES_STAMP    := $(STAMP_ROOT)/gc-ensign-es
GC_ENSIGN_ES_LOG      := $(LOG_ROOT)/gc-ensign-es
GC_ENSIGN_ES_INPUTS   := $(wildcard $(GC_ENSIGN_ES_ORIG_DIR)/*) $(wildcard $(GC_ENSIGN_ES_EDIT_DIR)/*)
# ES falls back to EN dirs, so include them in the range scan.
GC_ENSIGN_ES_ID_BOUNDS := $(shell { ls $(GC_ENSIGN_ES_ORIG_DIR) 2>/dev/null; ls $(GC_ENSIGN_ES_EDIT_DIR) 2>/dev/null; ls $(GC_ENSIGN_ORIG_DIR) 2>/dev/null; ls $(GC_ENSIGN_EDIT_DIR) 2>/dev/null; } | grep -E '^[0-9]+$$' | sort -n | awk 'NR==1{lo=$$0} END{print lo, $$0}')
GC_ENSIGN_ES_SHARDS   := $(shell awk -v lo='$(word 1,$(GC_ENSIGN_ES_ID_BOUNDS))' -v hi='$(word 2,$(GC_ENSIGN_ES_ID_BOUNDS))' -v n=$(SHARDS) $(SHARD_AWK))

REWRITE_TOOLS         := tools/rewrite
REWRITE_STAMP         := $(STAMP_ROOT)/rewrite
REWRITE_LOG           := $(LOG_ROOT)/rewrite

MOBILE_LANGS    := en es
MOBILE_OUT      := $(OUT_ROOT)/mobile
MOBILE_STAMP    := $(STAMP_ROOT)/mobile
MOBILE_LOG      := $(LOG_ROOT)/mobile
MOBILE_TOOLS    := tools/mobile

CORE_LANGS      := en es
CORE_OUT        := $(OUT_ROOT)/core
CORE_STAMP      := $(STAMP_ROOT)/core
CORE_LOG        := $(LOG_ROOT)/core
CORE_TOOLS      := tools/core
CORE_LUCENE_EN  ?= ../sci-search/lucene
CORE_LUCENE_ES  ?= ../sci-search/lucene-es
CORE_REMOTE_DIR ?= /var/www/scriptures-main
# Single source of truth: tools/core/VERSION is also read by config.ts.
CORE_VERSION    := $(shell cat tools/core/VERSION)

# Publish-lifecycle external tools.
SCI_INDEXER_DIR ?= $(HOME)/projects/sci-lucene-indexer
SCI_SEARCH_DIR  ?= $(HOME)/projects/sci-search

# mysql invocation. Password via MYSQL_PWD (keeps it off the command line).
MYSQL := mysql --login-path=sci2p $(DB_NAME)

PUBLISH_STAMP := $(STAMP_ROOT)/publish
PUBLISH_LOG   := $(LOG_ROOT)/publish

LIB_SCRIPTS    := $(wildcard tools/lib/*.ts)

STPJS_BUILD_STAMPS := $(STPJS_LANGS:%=$(STPJS_STAMP)/%/build.stamp)
STPJS_LOAD_STAMPS  := $(STPJS_LANGS:%=$(STPJS_STAMP)/%/load.stamp)

GC_ENSIGN_SHARD_STAMPS    := $(GC_ENSIGN_SHARDS:%=$(GC_ENSIGN_STAMP)/shard.%.stamp)
GC_ENSIGN_ES_SHARD_STAMPS := $(GC_ENSIGN_ES_SHARDS:%=$(GC_ENSIGN_ES_STAMP)/shard.%.stamp)

JOD_DB_STAMPS    := $(JOD_VOLUMES:%=$(JOD_STAMP)/db/JoD%.stamp)
JOD_DIV_STAMPS   := $(JOD_VOLUMES:%=$(JOD_STAMP)/div/JoD%.stamp)
JOD_LOAD_STAMPS  := $(JOD_VOLUMES:%=$(JOD_STAMP)/load/JoD%.stamp)
JOD_PUB_STAMPS   := $(JOD_VOLUMES:%=$(JOD_STAMP)/publish/JoD%.stamp)

JOD_VOLUME_TARGETS := $(addprefix jod-volume-,$(JOD_VOLUMES))

XSLT_CLEAN := npx tsx $(JOD_TOOLS)/xslt-cleanup.ts

# -----------------------------------------------------------------------------
# top-level phonies
# -----------------------------------------------------------------------------

.PHONY: all help clean test \
        stpjs stpjs-en stpjs-es stpjs-build stpjs-load \
        stpjs-build-en stpjs-build-es stpjs-load-en stpjs-load-es \
        jod jod-build jod-build-db jod-build-div jod-load jod-publish \
        gc-era gc-era-build gc-era-load \
        gc-ensign gc-ensign-build gc-ensign-load gc-ensign-rewrite \
        gc-ensign-es gc-ensign-es-build gc-ensign-es-load gc-ensign-es-rewrite \
        verse-sets $(JOD_VOLUME_TARGETS) \
        publish db-init swap-tables indexer-deploy \
        mobile-content mobile-content-en mobile-content-es \
        mobile-core mobile-core-en mobile-core-es \
        mobile-core-deploy search-restart

all: stpjs jod gc-era gc-ensign gc-ensign-es verse-sets

clean:
	rm -rf $(OUT_ROOT) $(STAMP_ROOT) $(LOG_ROOT)

node_modules: package.json
	@npm install --silent
	@touch $@

# -----------------------------------------------------------------------------
# stpjs
# -----------------------------------------------------------------------------

stpjs:          stpjs-build stpjs-load
stpjs-build:    $(STPJS_BUILD_STAMPS)
stpjs-load:     $(STPJS_LOAD_STAMPS)

stpjs-en:       $(STPJS_STAMP)/en/build.stamp $(STPJS_STAMP)/en/load.stamp
stpjs-es:       $(STPJS_STAMP)/es/build.stamp $(STPJS_STAMP)/es/load.stamp

stpjs-build-en: $(STPJS_STAMP)/en/build.stamp
stpjs-build-es: $(STPJS_STAMP)/es/build.stamp
stpjs-load-en:  $(STPJS_STAMP)/en/load.stamp
stpjs-load-es:  $(STPJS_STAMP)/es/load.stamp

.SECONDEXPANSION:

$(STPJS_STAMP)/%/build.stamp: $$(wildcard stpjs/%/stpjs*.xml) $(STPJS_TOOLS)/add-citations.ts $(STPJS_TOOLS)/config.ts $(LIB_SCRIPTS) | node_modules
	@mkdir -p $(@D) $(STPJS_OUT)/$* $(STPJS_LOG)/$*
	@echo "[stpjs build $*] add citations → $(STPJS_OUT)/$*/"
	@XML_DIR=stpjs/$* OUT_DIR=$(STPJS_OUT)/$* \
	    npx tsx $(STPJS_TOOLS)/add-citations.ts --lang $* \
	    > $(STPJS_LOG)/$*/add-citations.log 2>&1
	$(call split_but_todo,$(STPJS_LOG)/$*)
	@touch $@

$(STPJS_STAMP)/%/load.stamp: $(STPJS_STAMP)/%/build.stamp $(STPJS_TOOLS)/load-sci2-db.ts $(STPJS_TOOLS)/config.ts $(LIB_SCRIPTS) | node_modules
	@mkdir -p $(@D) $(STPJS_LOG)/$*
	@echo "[stpjs load $*] $(STPJS_OUT)/$*/*.html → MySQL"
	@OUT_DIR=$(STPJS_OUT)/$* \
	    npx tsx $(STPJS_TOOLS)/load-sci2-db.ts --lang $* \
	    > $(STPJS_LOG)/$*/load.log 2>&1
	@touch $@

# -----------------------------------------------------------------------------
# jod
# -----------------------------------------------------------------------------

jod:           jod-build jod-load jod-publish
jod-build:     jod-build-db jod-build-div
jod-build-db:  $(JOD_DB_STAMPS)
jod-build-div: $(JOD_DIV_STAMPS)
jod-load:      $(JOD_LOAD_STAMPS)
jod-publish:   $(JOD_PUB_STAMPS)

$(JOD_CITE_SHA): FORCE | $(JOD_STAMP)
	@npx tsx $(JOD_TOOLS)/citation-sha.ts > $@.tmp
	@if [ ! -f $@ ] || ! cmp -s $@.tmp $@; then \
	    mv $@.tmp $@; \
	    echo "[jod citations] SHA changed → $$(cat $@)"; \
	else rm -f $@.tmp; fi
FORCE:

$(JOD_STAMP)/db/JoD%.stamp: $(JOD_XML_DIR)/JoD%.xml $(JOD_CITE_SHA) $(JOD_XSL)/jod-div2.xsl $(JOD_TOOLS)/add-citations.ts $(JOD_TOOLS)/xslt-cleanup.ts $(LIB_SCRIPTS) | $(JOD_DB_DIR) $(JOD_LOG) node_modules
	@mkdir -p $(@D)
	@echo "[jod build-db $*] XSLT + citations"
	@$(XSLT_CLEAN) -i $< -o $(JOD_DB_DIR) -s $(JOD_XSL)/jod-div2.xsl -v $* \
	    > $(JOD_LOG)/build-db-$*.log 2>&1
	@DB_DIR=$(JOD_DB_DIR) npx tsx $(JOD_TOOLS)/add-citations.ts --volume $* \
	    >> $(JOD_LOG)/build-db-$*.log 2>&1
	@touch $@

$(JOD_STAMP)/div/JoD%.stamp: $(JOD_XML_DIR)/JoD%.xml $(JOD_XSL)/jod-div.xsl $(JOD_TOOLS)/xslt-cleanup.ts $(LIB_SCRIPTS) | $(JOD_DIV_DIR) $(JOD_LOG) node_modules
	@mkdir -p $(@D)
	@echo "[jod build-div $*] XSLT"
	@$(XSLT_CLEAN) -i $< -o $(JOD_DIV_DIR) -s $(JOD_XSL)/jod-div.xsl -v $* \
	    > $(JOD_LOG)/build-div-$*.log 2>&1
	@touch $@

$(JOD_STAMP)/load/JoD%.stamp: $(JOD_STAMP)/db/JoD%.stamp $(JOD_TOOLS)/load-sci2-db.ts $(LIB_SCRIPTS) | $(JOD_LOG) node_modules
	@mkdir -p $(@D)
	@echo "[jod load $*] → MySQL talkbody2"
	@DB_DIR=$(JOD_DB_DIR) npx tsx $(JOD_TOOLS)/load-sci2-db.ts --volume $* \
	    > $(JOD_LOG)/load-$*.log 2>&1
	@touch $@

$(JOD_STAMP)/publish/JoD%.stamp: $(JOD_STAMP)/div/JoD%.stamp $(JOD_CITE_SHA) $(JOD_TOOLS)/publish-discourse.ts $(LIB_SCRIPTS) | $(JOD_LOG) node_modules
	@mkdir -p $(@D) $(JOD_PUBLISH)
	@echo "[jod publish $*] → $(JOD_PUBLISH)"
	@DIV_DIR=$(JOD_DIV_DIR) PUBLISH_DIR=$(JOD_PUBLISH) \
	    npx tsx $(JOD_TOOLS)/publish-discourse.ts --volume $* \
	    > $(JOD_LOG)/publish-$*.log 2>&1
	@echo "[jod publish $*] scp → $(SCP_HOST):$(JOD_REMOTE_DIR)"
	@scp -q $(JOD_PUBLISH)/JoD$**.html $(SCP_HOST):$(JOD_REMOTE_DIR)/ \
	    >> $(JOD_LOG)/publish-$*.log 2>&1 \
	    || { echo "[jod publish $*] FAILED — see $(JOD_LOG)/publish-$*.log:"; tail $(JOD_LOG)/publish-$*.log; false; }
	@touch $@

$(JOD_VOLUME_TARGETS): jod-volume-%: $(JOD_STAMP)/db/JoD%.stamp $(JOD_STAMP)/div/JoD%.stamp \
                                    $(JOD_STAMP)/load/JoD%.stamp $(JOD_STAMP)/publish/JoD%.stamp
	@echo "jod volume $* ready"

$(JOD_DB_DIR) $(JOD_DIV_DIR) $(JOD_LOG) $(JOD_STAMP):
	@mkdir -p $@

# -----------------------------------------------------------------------------
# gc-era
# -----------------------------------------------------------------------------

gc-era:       gc-era-build gc-era-load
gc-era-build: $(GC_ERA_STAMP)/build.stamp
gc-era-load:  $(GC_ERA_STAMP)/load.stamp

$(GC_ERA_STAMP)/build.stamp: $(GC_ERA_XML) $(GC_ERA_TOOLS)/add-citations.ts $(GC_ERA_TOOLS)/config.ts $(LIB_SCRIPTS) | node_modules
	@mkdir -p $(@D) $(GC_ERA_OUT) $(GC_ERA_LOG)
	@echo "[gc-era build] add citations → $(GC_ERA_OUT)/"
	@XML_DIR=$(GC_ERA_XML_DIR) OUT_DIR=$(GC_ERA_OUT) \
	    npx tsx $(GC_ERA_TOOLS)/add-citations.ts \
	    > $(GC_ERA_LOG)/add-citations.log 2>&1
	$(call split_but_todo,$(GC_ERA_LOG))
	@touch $@

$(GC_ERA_STAMP)/load.stamp: $(GC_ERA_STAMP)/build.stamp $(GC_ERA_TOOLS)/load-sci2-db.ts $(GC_ERA_TOOLS)/config.ts $(LIB_SCRIPTS) | node_modules
	@mkdir -p $(@D) $(GC_ERA_LOG)
	@echo "[gc-era load] $(GC_ERA_OUT)/*.html → MySQL talkbody2"
	@OUT_DIR=$(GC_ERA_OUT) \
	    npx tsx $(GC_ERA_TOOLS)/load-sci2-db.ts \
	    > $(GC_ERA_LOG)/load.log 2>&1
	@touch $@

# -----------------------------------------------------------------------------
# gc-ensign (EN)
# -----------------------------------------------------------------------------

gc-ensign:         gc-ensign-build gc-ensign-load gc-ensign-rewrite
gc-ensign-build:   $(GC_ENSIGN_STAMP)/build.stamp
gc-ensign-load:    $(GC_ENSIGN_STAMP)/load.stamp
gc-ensign-rewrite: $(GC_ENSIGN_STAMP)/rewrite.stamp

$(GC_ENSIGN_STAMP)/shard.%.stamp: $(GC_ENSIGN_INPUTS) $(GC_ENSIGN_TOOLS)/add-citations.ts $(GC_ENSIGN_TOOLS)/config.ts $(LIB_SCRIPTS) | node_modules
	@mkdir -p $(@D) $(GC_ENSIGN_OUT) $(GC_ENSIGN_LOG)
	@echo "[gc-ensign build $*] add citations → $(GC_ENSIGN_OUT)/"
	@ORIG_DIR=$(GC_ENSIGN_ORIG_DIR) EDIT_DIR=$(GC_ENSIGN_EDIT_DIR) OUT_DIR=$(GC_ENSIGN_OUT) \
	    npx tsx $(GC_ENSIGN_TOOLS)/add-citations.ts --lang en --range $* \
	    > $(GC_ENSIGN_LOG)/add-citations.$*.log 2>&1
	@touch $@

$(GC_ENSIGN_STAMP)/build.stamp: $(GC_ENSIGN_SHARD_STAMPS)
	@test -n "$(GC_ENSIGN_SHARDS)" || { echo "[gc-ensign] no shards computed — check $(GC_ENSIGN_ORIG_DIR) / $(GC_ENSIGN_EDIT_DIR)" >&2; exit 1; }
	@cat $(GC_ENSIGN_SHARDS:%=$(GC_ENSIGN_LOG)/add-citations.%.log) > $(GC_ENSIGN_LOG)/add-citations.log
	$(call split_but_todo,$(GC_ENSIGN_LOG))
	@touch $@

$(GC_ENSIGN_STAMP)/load.stamp: $(GC_ENSIGN_STAMP)/build.stamp $(GC_ENSIGN_TOOLS)/load-sci2-db.ts $(GC_ENSIGN_TOOLS)/config.ts $(LIB_SCRIPTS) | node_modules
	@mkdir -p $(@D) $(GC_ENSIGN_LOG)
	@echo "[gc-ensign load] $(GC_ENSIGN_OUT)/ → MySQL talkbody2"
	@OUT_DIR=$(GC_ENSIGN_OUT) \
	    npx tsx $(GC_ENSIGN_TOOLS)/load-sci2-db.ts --lang en \
	    > $(GC_ENSIGN_LOG)/load.log 2>&1
	@touch $@

$(GC_ENSIGN_STAMP)/rewrite.stamp: $(GC_ENSIGN_STAMP)/load.stamp $(REWRITE_TOOLS)/process.ts $(LIB_SCRIPTS) | node_modules
	@mkdir -p $(@D) $(GC_ENSIGN_LOG)
	@echo "[gc-ensign rewrite] processTalkBody --lang en (talkbody2)"
	@npx tsx $(REWRITE_TOOLS)/process.ts --lang en \
	    > $(GC_ENSIGN_LOG)/rewrite.log 2>&1
	@touch $@

# -----------------------------------------------------------------------------
# gc-ensign-es (ES)
# -----------------------------------------------------------------------------

gc-ensign-es:         gc-ensign-es-build gc-ensign-es-load gc-ensign-es-rewrite
gc-ensign-es-build:   $(GC_ENSIGN_ES_STAMP)/build.stamp
gc-ensign-es-load:    $(GC_ENSIGN_ES_STAMP)/load.stamp
gc-ensign-es-rewrite: $(GC_ENSIGN_ES_STAMP)/rewrite.stamp

$(GC_ENSIGN_ES_STAMP)/shard.%.stamp: $(GC_ENSIGN_ES_INPUTS) $(GC_ENSIGN_INPUTS) $(GC_ENSIGN_TOOLS)/add-citations.ts $(GC_ENSIGN_TOOLS)/config.ts $(LIB_SCRIPTS) | node_modules
	@mkdir -p $(@D) $(GC_ENSIGN_ES_OUT) $(GC_ENSIGN_ES_LOG)
	@echo "[gc-ensign-es build $*] add citations → $(GC_ENSIGN_ES_OUT)/"
	@ORIG_DIR=$(GC_ENSIGN_ES_ORIG_DIR) EDIT_DIR=$(GC_ENSIGN_ES_EDIT_DIR) \
	    EN_ORIG_DIR=$(GC_ENSIGN_ORIG_DIR) EN_EDIT_DIR=$(GC_ENSIGN_EDIT_DIR) \
	    OUT_DIR=$(GC_ENSIGN_ES_OUT) \
	    npx tsx $(GC_ENSIGN_TOOLS)/add-citations.ts --lang es --range $* \
	    > $(GC_ENSIGN_ES_LOG)/add-citations.$*.log 2>&1
	@touch $@

$(GC_ENSIGN_ES_STAMP)/build.stamp: $(GC_ENSIGN_ES_SHARD_STAMPS)
	@test -n "$(GC_ENSIGN_ES_SHARDS)" || { echo "[gc-ensign-es] no shards computed — check $(GC_ENSIGN_ES_ORIG_DIR) / $(GC_ENSIGN_ES_EDIT_DIR) (falls back to $(GC_ENSIGN_ORIG_DIR) / $(GC_ENSIGN_EDIT_DIR))" >&2; exit 1; }
	@cat $(GC_ENSIGN_ES_SHARDS:%=$(GC_ENSIGN_ES_LOG)/add-citations.%.log) > $(GC_ENSIGN_ES_LOG)/add-citations.log
	$(call split_but_todo,$(GC_ENSIGN_ES_LOG))
	@touch $@

$(GC_ENSIGN_ES_STAMP)/load.stamp: $(GC_ENSIGN_ES_STAMP)/build.stamp $(GC_ENSIGN_TOOLS)/load-sci2-db.ts $(GC_ENSIGN_TOOLS)/config.ts $(LIB_SCRIPTS) | node_modules
	@mkdir -p $(@D) $(GC_ENSIGN_ES_LOG)
	@echo "[gc-ensign-es load] $(GC_ENSIGN_ES_OUT)/ → MySQL talkbody2_es"
	@OUT_DIR=$(GC_ENSIGN_ES_OUT) \
	    npx tsx $(GC_ENSIGN_TOOLS)/load-sci2-db.ts --lang es \
	    > $(GC_ENSIGN_ES_LOG)/load.log 2>&1
	@touch $@

$(GC_ENSIGN_ES_STAMP)/rewrite.stamp: $(GC_ENSIGN_ES_STAMP)/load.stamp $(REWRITE_TOOLS)/process.ts $(LIB_SCRIPTS) | node_modules
	@mkdir -p $(@D) $(GC_ENSIGN_ES_LOG)
	@echo "[gc-ensign-es rewrite] processTalkBody --lang es (talkbody2_es)"
	@npx tsx $(REWRITE_TOOLS)/process.ts --lang es \
	    > $(GC_ENSIGN_ES_LOG)/rewrite.log 2>&1
	@touch $@

# -----------------------------------------------------------------------------
# test
# -----------------------------------------------------------------------------

test: | node_modules
	@npm test

# -----------------------------------------------------------------------------
# verse-sets
# -----------------------------------------------------------------------------

verse-sets: $(VERSE_STAMP)/calculate.stamp

$(VERSE_STAMP)/calculate.stamp: $(VERSE_TOOLS)/calculate-verse-sets.ts $(LIB_SCRIPTS) | node_modules
	@mkdir -p $(@D) $(VERSE_LOG)
	@echo "[verse-sets] calculate MinVerse/MaxVerse/citation_verse"
	@npx tsx $(VERSE_TOOLS)/calculate-verse-sets.ts \
	    > $(VERSE_LOG)/calculate.log 2>&1
	@touch $@

# -----------------------------------------------------------------------------
# publish lifecycle (ports PUBLISH-ALL to make)
# -----------------------------------------------------------------------------
#
# Full pipeline:
#   1. db-init         ensure talkbody2 / talkbody2_es tables exist
#   2. all             stpjs + jod + gc-era + gc-ensign[-es] + verse-sets
#   3. swap-tables     atomic RENAME: talkbody <-> talkbody2 (EN + ES in one stmt)
#   4. indexer-deploy  ||  mobile-core  (run in parallel under -jN; mobile-core
#                      transitively builds mobile-content-{en,es} before packaging)
#
# search-restart is NOT part of `publish` (matches PUBLISH-ALL, which only
# prints the kill/CHECK_SCI_SEARCH commands for manual review). Run it
# separately when you're ready to cut over the running search process.
#
# Tip: `make -jN publish` overlaps indexer-deploy with mobile-content builds.

publish:
	@$(MAKE) db-init
	@$(MAKE) all
	@$(MAKE) swap-tables
	@$(MAKE) indexer-deploy mobile-core
	@echo "[publish] complete — run 'make search-restart' when ready to cut over"

db-init: $(PUBLISH_STAMP)/db-init.stamp

$(PUBLISH_STAMP)/db-init.stamp: tools/db-init/TALKBODY2.sql
	@mkdir -p $(@D) $(PUBLISH_LOG)
	@echo "[db-init] load TALKBODY2.sql (create talkbody2 / talkbody2_es if absent)"
	@$(MYSQL) < tools/db-init/TALKBODY2.sql > $(PUBLISH_LOG)/db-init.log 2>&1
	@touch $@

# Always rerun — this is the production cutover step, not a cached computation.
# Single RENAME TABLE with multiple pairs is atomic across all six renames.
swap-tables:
	@mkdir -p $(PUBLISH_LOG)
	@echo "[swap-tables] atomic RENAME talkbody <-> talkbody2 (EN + ES)"
	@echo "RENAME TABLE \
	    talkbody TO talkbody1, talkbody2 TO talkbody, talkbody1 TO talkbody2, \
	    talkbody_es TO talkbody1_es, talkbody2_es TO talkbody_es, talkbody1_es TO talkbody2_es;" \
	    | $(MYSQL) > $(PUBLISH_LOG)/swap-tables.log 2>&1

indexer-deploy:
	@mkdir -p $(PUBLISH_LOG)
	@echo "[indexer-deploy] $(SCI_INDEXER_DIR)/DEPLOY"
	@cd $(SCI_INDEXER_DIR) && ./DEPLOY > $(CURDIR)/$(PUBLISH_LOG)/indexer-deploy.log 2>&1 \
	    || { echo "[indexer-deploy] FAILED — see $(PUBLISH_LOG)/indexer-deploy.log:"; tail $(CURDIR)/$(PUBLISH_LOG)/indexer-deploy.log; false; }

mobile-content:    mobile-content-en mobile-content-es
mobile-content-en: $(MOBILE_STAMP)/en/package.stamp
mobile-content-es: $(MOBILE_STAMP)/es/package.stamp

# Build stamps are intermediate in the chain build → package. Pin them so
# incremental rebuilds aren't forced to re-run the DB build every time.
.SECONDARY: $(MOBILE_LANGS:%=$(MOBILE_STAMP)/%/build.stamp)

$(MOBILE_STAMP)/%/build.stamp: $(MOBILE_TOOLS)/build.ts $(MOBILE_TOOLS)/sources.ts $(MOBILE_TOOLS)/config.ts $(LIB_SCRIPTS) | node_modules
	@mkdir -p $(@D) $(MOBILE_OUT) $(MOBILE_LOG)
	@echo "[mobile build $*] → $(MOBILE_OUT)/"
	@MOBILE_OUT_DIR=$(MOBILE_OUT) \
	    npx tsx $(MOBILE_TOOLS)/build.ts --lang $* \
	    > $(MOBILE_LOG)/build-$*.log 2>&1
	@touch $@

$(MOBILE_STAMP)/%/package.stamp: $(MOBILE_STAMP)/%/build.stamp $(MOBILE_TOOLS)/package.ts $(MOBILE_TOOLS)/config.ts | node_modules
	@mkdir -p $(@D) $(MOBILE_LOG)
	@echo "[mobile package $*] → $(MOBILE_OUT)/"
	@MOBILE_OUT_DIR=$(MOBILE_OUT) \
	    npx tsx $(MOBILE_TOOLS)/package.ts --lang $* \
	    > $(MOBILE_LOG)/package-$*.log 2>&1
	@touch $@

# mobile-core: build the sci.$V.zip deploy archive per lang. Each package
# depends on its own core build AND the matching mobile-content package,
# since the core zip bundles the content.$V.db produced there.
#
# The builds mutate MySQL's next_talk table (port of UPDATE_IDS) — run EN
# and ES serially so their rewrites don't overlap. make's default is
# serial, and even with -jN the order is enforced by mobile-core-es
# depending on mobile-core-en.
CORE_SOURCES := $(wildcard $(CORE_TOOLS)/sources/*.ts)

mobile-core:    mobile-core-en mobile-core-es
mobile-core-en: $(CORE_STAMP)/en/package.stamp
mobile-core-es: $(CORE_STAMP)/es/package.stamp $(CORE_STAMP)/en/package.stamp

.SECONDARY: $(CORE_LANGS:%=$(CORE_STAMP)/%/build.stamp)

# refreshNextTalkIds() mutates MySQL's next_talk inside build.ts, so EN and
# ES builds must not overlap even under -jN. Chain the ES build stamp after
# the EN one (the package layer already serializes; this serializes builds
# triggered directly, e.g. `make -j mobile-core-en mobile-core-es`).
$(CORE_STAMP)/es/build.stamp: $(CORE_STAMP)/en/build.stamp

$(CORE_STAMP)/%/build.stamp: $(CORE_TOOLS)/build.ts $(CORE_TOOLS)/config.ts $(CORE_SOURCES) $(LIB_SCRIPTS) | node_modules
	@mkdir -p $(@D) $(CORE_OUT) $(CORE_LOG)
	@echo "[core build $*] → $(CORE_OUT)/"
	@CORE_OUT_DIR=$(CORE_OUT) \
	    npx tsx $(CORE_TOOLS)/build.ts --lang $* \
	    > $(CORE_LOG)/build-$*.log 2>&1
	@touch $@

$(CORE_STAMP)/%/package.stamp: $(CORE_STAMP)/%/build.stamp $(MOBILE_STAMP)/%/package.stamp $(CORE_TOOLS)/package.ts $(CORE_TOOLS)/config.ts | node_modules
	@mkdir -p $(@D) $(CORE_LOG)
	@echo "[core package $*] → $(CORE_OUT)/"
	@CORE_OUT_DIR=$(CORE_OUT) MOBILE_OUT_DIR=$(MOBILE_OUT) \
	    CORE_LUCENE_EN=$(CORE_LUCENE_EN) CORE_LUCENE_ES=$(CORE_LUCENE_ES) \
	    npx tsx $(CORE_TOOLS)/package.ts --lang $* \
	    > $(CORE_LOG)/package-$*.log 2>&1
	@touch $@

# Ports core/DEPLOY — copies the four sci.$V.{config,zip} + sci-es.$V.{config,zip}
# artifacts to $(SCP_HOST):$(CORE_REMOTE_DIR). Always re-runs; not part of
# `publish` (run explicitly once you're satisfied with the built zips).
mobile-core-deploy: $(CORE_STAMP)/en/package.stamp $(CORE_STAMP)/es/package.stamp
	@mkdir -p $(CORE_LOG)
	@echo "[core deploy] scp sci.$(CORE_VERSION).{config,zip} + sci-es.$(CORE_VERSION).{config,zip} → $(SCP_HOST):$(CORE_REMOTE_DIR)/"
	@scp -q \
	    $(CORE_OUT)/sci.$(CORE_VERSION).config \
	    $(CORE_OUT)/sci.$(CORE_VERSION).zip \
	    $(CORE_OUT)/sci-es.$(CORE_VERSION).config \
	    $(CORE_OUT)/sci-es.$(CORE_VERSION).zip \
	    $(SCP_HOST):$(CORE_REMOTE_DIR)/ \
	    > $(CORE_LOG)/deploy.log 2>&1 \
	    || { echo "[core deploy] FAILED — see $(CORE_LOG)/deploy.log:"; cat $(CORE_LOG)/deploy.log; false; }

# Kills the running sci-search java process and relaunches via CHECK_SCI_SEARCH.
# PUBLISH-ALL echoed these commands rather than running them — run manually.
search-restart:
	@mkdir -p $(PUBLISH_LOG)
	@JOB=$$(ps -edf | grep java | grep sci-search | grep -v grep | awk '{print $$2}'); \
	    if [ -n "$$JOB" ]; then echo "[search-restart] kill $$JOB"; kill $$JOB; \
	    else echo "[search-restart] no running sci-search process found"; fi
	@echo "[search-restart] $(SCI_SEARCH_DIR)/CHECK_SCI_SEARCH"
	@$(SCI_SEARCH_DIR)/CHECK_SCI_SEARCH > $(PUBLISH_LOG)/search-restart.log 2>&1

# -----------------------------------------------------------------------------
# help
# -----------------------------------------------------------------------------

help:
	@echo "Top-level targets:"
	@echo "  all            stpjs + jod + gc-era + gc-ensign + gc-ensign-es + verse-sets"
	@echo "  test           run smoke tests (tests/citations)"
	@echo "  clean          remove $(OUT_ROOT)/, $(STAMP_ROOT)/, $(LOG_ROOT)/"
	@echo ""
	@echo "stpjs:"
	@echo "  stpjs          build+load en+es"
	@echo "  stpjs-en       build+load English only (talkbody2)"
	@echo "  stpjs-es       build+load Spanish only (talkbody2_es)"
	@echo "  stpjs-build    add-citations for all stpjs languages"
	@echo "  stpjs-load     load all stpjs languages into MySQL"
	@echo "  stpjs-{build,load}-{en,es}   phase-per-lang"
	@echo ""
	@echo "jod:"
	@echo "  jod            build + load + publish (all volumes)"
	@echo "  jod-build      build-db + build-div for all volumes"
	@echo "  jod-build-db   HTML with citations for talkbody2 loader"
	@echo "  jod-build-div  HTML used for web publication"
	@echo "  jod-load       out/jod/db/*.html → MySQL talkbody2"
	@echo "  jod-publish    rewrite out/jod/div → out/jod/publish + scp"
	@echo "  jod-volume-NN  run every jod phase for one volume"
	@echo ""
	@echo "gc-era:"
	@echo "  gc-era         build + load Improvement Era talks into talkbody2"
	@echo "  gc-era-build   add-citations on gc-era/talk*.xml → $(GC_ERA_OUT)/"
	@echo "  gc-era-load    $(GC_ERA_OUT)/*.html → MySQL talkbody2 (TalkID 1..1830)"
	@echo ""
	@echo "gc-ensign (EN):"
	@echo "  gc-ensign           build + load + rewrite English Ensign into talkbody2"
	@echo "  gc-ensign-build     add-citations on gc-ensign/{orig,edit}/ → $(GC_ENSIGN_OUT)/"
	@echo "  gc-ensign-load      $(GC_ENSIGN_OUT)/ → MySQL talkbody2 (TalkID 2000..8493)"
	@echo "  gc-ensign-rewrite   processTalkBody → ProcessedText in talkbody2"
	@echo ""
	@echo "gc-ensign-es (ES):"
	@echo "  gc-ensign-es         build + load + rewrite Spanish Ensign into talkbody2_es"
	@echo "  gc-ensign-es-build   add-citations on gc-ensign-es (EN fallback) → $(GC_ENSIGN_ES_OUT)/"
	@echo "  gc-ensign-es-load    $(GC_ENSIGN_ES_OUT)/ → MySQL talkbody2_es"
	@echo "  gc-ensign-es-rewrite processTalkBody → ProcessedText in talkbody2_es"
	@echo ""
	@echo "verse-sets:"
	@echo "  verse-sets     recompute citation MinVerse/MaxVerse + citation_verse"
	@echo ""
	@echo "publish lifecycle (ports PUBLISH-ALL):"
	@echo "  publish          db-init + all + swap-tables + (indexer-deploy || mobile-core)"
	@echo "  db-init          load TALKBODY2.sql (create talkbody2 / talkbody2_es if absent)"
	@echo "  swap-tables      atomic RENAME: talkbody <-> talkbody2 (EN + ES)"
	@echo "  indexer-deploy   $(SCI_INDEXER_DIR)/DEPLOY"
	@echo "  mobile-content       build+package mobile content sqlite (EN+ES)"
	@echo "  mobile-content-{en,es}  per-lang build+package → $(MOBILE_OUT)/"
	@echo "  mobile-core          build+package sci.\$$(VERSION).zip deploy (EN+ES)"
	@echo "  mobile-core-{en,es}     per-lang build+package → $(CORE_OUT)/"
	@echo "  mobile-core-deploy   scp sci[-es].$(CORE_VERSION).{config,zip} → $(SCP_HOST):$(CORE_REMOTE_DIR)/"
	@echo "  search-restart   kill java sci-search + $(SCI_SEARCH_DIR)/CHECK_SCI_SEARCH (manual)"
	@echo ""
	@echo "Parallelism:"
	@echo "  make -jN           safe across volumes/languages"
	@echo "  SHARDS=N           number of parallel shards per gc-ensign[-es] build (default $(SHARDS))"
	@echo ""
	@echo "Env: .env supplies DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD SCP_HOST JOD_REMOTE_DIR"
	@echo "     SCI_INDEXER_DIR SCI_SEARCH_DIR override publish-step paths"
	@echo "     CORE_LUCENE_EN CORE_LUCENE_ES override Lucene index dirs (default ../sci-search/lucene[-es])"
