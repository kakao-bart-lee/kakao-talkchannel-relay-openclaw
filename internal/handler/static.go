package handler

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
)

type SPAHandler struct {
	staticDir string
	indexFile string
}

func NewSPAHandler(staticDir string) *SPAHandler {
	return &SPAHandler{
		staticDir: staticDir,
		indexFile: "index.html",
	}
}

func (h *SPAHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Get the wildcard path from Chi router context
	path := chi.URLParam(r, "*")
	if path == "" {
		path = "/"
	}

	if strings.HasPrefix(path, "api/") {
		http.NotFound(w, r)
		return
	}

	filePath := filepath.Join(h.staticDir, path)

	info, err := os.Stat(filePath)
	if err == nil && !info.IsDir() {
		http.ServeFile(w, r, filePath)
		return
	}

	indexPath := filepath.Join(h.staticDir, h.indexFile)
	if _, err := os.Stat(indexPath); err != nil {
		http.NotFound(w, r)
		return
	}

	http.ServeFile(w, r, indexPath)
}

func StaticFileServer(staticDir string) http.Handler {
	return NewSPAHandler(staticDir)
}
