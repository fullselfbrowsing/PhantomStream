# Build the PhantomStream IEEE paper.
#
# This repo uses tectonic because it is available in the local workspace and can
# fetch the standard IEEEtran/TikZ/pgfplots dependencies on demand.

MAIN := main

.PHONY: all pdf clean distclean

all: pdf

pdf:
	tectonic $(MAIN).tex

clean:
	rm -f $(MAIN).aux $(MAIN).bbl $(MAIN).bcf $(MAIN).blg $(MAIN).log $(MAIN).out $(MAIN).run.xml $(MAIN).toc

distclean: clean
	rm -f $(MAIN).pdf
