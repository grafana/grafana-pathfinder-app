package provider

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// publicRoutesWithoutCallerIdentity is the reviewed list of routes whose handler never derives a caller.
// Adding a route here means serving it with no verified identity, so a change to this map needs the same
// review as a change to the unprovisioned-client exemption switch in newApp. Anything personal or tenant-scoped
// belongs in neither. See "How to add or change a route" in docs/design/BACKEND_PROXY_PATTERN.md.
var publicRoutesWithoutCallerIdentity = map[string]string{
	"/backend/package-recommendations": "anonymous public CDN recommendations feed; also in the unprovisioned-client exemption switch",
	"/backend/health":                  "returns a fixed status document and reads no data",
}

type routeHandler struct {
	path    string
	method  string
	handler string
}

// routesWithoutVerifiedCaller returns one message per registered route whose handler cannot reach
// callerNamespace or completionCaller and is not in allowed. Reachability follows every package-level
// function the handler references, including inside closures.
func routesWithoutVerifiedCaller(files map[string]string, allowed map[string]string) ([]string, error) {
	fset := token.NewFileSet()
	functions := map[string]*ast.FuncDecl{}
	var routes []routeHandler
	for name, source := range files {
		file, err := parser.ParseFile(fset, name, source, 0)
		if err != nil {
			return nil, err
		}
		for _, declaration := range file.Decls {
			if function, ok := declaration.(*ast.FuncDecl); ok && function.Recv == nil && function.Body != nil {
				functions[function.Name.Name] = function
			}
		}
		routes = append(routes, registeredRoutes(file)...)
	}
	if len(routes) == 0 {
		return nil, fmt.Errorf("no routes found in VersionedCustomRoutes; update this ratchet if the registration moved")
	}

	reachesIdentity := func(root string) bool {
		queue, seen := []string{root}, map[string]bool{root: true}
		for len(queue) > 0 {
			name := queue[0]
			queue = queue[1:]
			function := functions[name]
			if function == nil {
				continue
			}
			found := false
			ast.Inspect(function.Body, func(node ast.Node) bool {
				identifier, ok := node.(*ast.Ident)
				if !ok {
					return !found
				}
				switch {
				case identifier.Name == "callerNamespace" || identifier.Name == "completionCaller":
					found = true
				case functions[identifier.Name] != nil && !seen[identifier.Name]:
					seen[identifier.Name] = true
					queue = append(queue, identifier.Name)
				}
				return !found
			})
			if found {
				return true
			}
		}
		return false
	}

	var violations []string
	registered := map[string]bool{}
	for _, route := range routes {
		registered[route.path] = true
	}
	for path := range allowed {
		if !registered[path] {
			violations = append(violations, fmt.Sprintf("%s is in the public-route allowlist but is not a registered route; remove the stale entry", path))
		}
	}
	for _, route := range routes {
		if _, ok := allowed[route.path]; ok {
			continue
		}
		if !reachesIdentity(route.handler) {
			violations = append(violations, fmt.Sprintf("%s %s is served by %s, which never reaches callerNamespace or completionCaller", route.method, route.path, route.handler))
		}
	}
	sort.Strings(violations)
	return violations, nil
}

// registeredRoutes reads the simple.AppVersionRoute keys of every VersionedCustomRoutes literal in file.
func registeredRoutes(file *ast.File) []routeHandler {
	var routes []routeHandler
	ast.Inspect(file, func(node ast.Node) bool {
		pair, ok := node.(*ast.KeyValueExpr)
		if !ok {
			return true
		}
		key, ok := pair.Key.(*ast.CompositeLit)
		if !ok || !strings.HasSuffix(exprText(key.Type), "AppVersionRoute") {
			return true
		}
		route := routeHandler{handler: handlerName(pair.Value)}
		for _, element := range key.Elts {
			field, ok := element.(*ast.KeyValueExpr)
			if !ok {
				continue
			}
			switch exprText(field.Key) {
			case "Path":
				if literal, ok := field.Value.(*ast.BasicLit); ok {
					route.path, _ = strconv.Unquote(literal.Value)
				}
			case "Method":
				route.method = strings.TrimPrefix(exprText(field.Value), "simple.AppCustomRouteMethod")
			}
		}
		routes = append(routes, route)
		return true
	})
	return routes
}

func handlerName(value ast.Expr) string {
	if call, ok := value.(*ast.CallExpr); ok {
		return exprText(call.Fun)
	}
	return exprText(value)
}

func exprText(expression ast.Expr) string {
	switch value := expression.(type) {
	case *ast.Ident:
		return value.Name
	case *ast.SelectorExpr:
		return exprText(value.X) + "." + value.Sel.Name
	}
	return ""
}

func TestEveryRegisteredRouteVerifiesTheCaller(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	files := map[string]string{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") || strings.HasSuffix(entry.Name(), "_test.go") {
			continue
		}
		source, err := os.ReadFile(filepath.Clean(entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		files[entry.Name()] = string(source)
	}
	violations, err := routesWithoutVerifiedCaller(files, publicRoutesWithoutCallerIdentity)
	if err != nil {
		t.Fatal(err)
	}
	if len(violations) > 0 {
		t.Fatalf("Every tenant route must derive its caller with callerNamespace or completionCaller before touching storage.\n  %s\nFix the handler. Only a genuinely public route may be added to publicRoutesWithoutCallerIdentity, and that change needs review. See \"How to add or change a route\" in docs/design/BACKEND_PROXY_PATTERN.md.", strings.Join(violations, "\n  "))
	}
}

func TestPublicRouteAllowlistStaysInsideTheUnprovisionedExemption(t *testing.T) {
	source, err := os.ReadFile("provider.go")
	if err != nil {
		t.Fatal(err)
	}
	file, err := parser.ParseFile(token.NewFileSet(), "provider.go", source, 0)
	if err != nil {
		t.Fatal(err)
	}
	exempt := map[string]bool{}
	ast.Inspect(file, func(node ast.Node) bool {
		if clause, ok := node.(*ast.CaseClause); ok {
			for _, expression := range clause.List {
				if literal, ok := expression.(*ast.BasicLit); ok && literal.Kind == token.STRING {
					path, _ := strconv.Unquote(literal.Value)
					exempt[path] = true
				}
			}
		}
		return true
	})
	if !exempt["/backend/package-recommendations"] {
		t.Fatal("could not find the unprovisioned-client exemption switch in newApp; update this ratchet if it moved")
	}
	for path := range publicRoutesWithoutCallerIdentity {
		if path != "/backend/health" && !exempt[path] {
			t.Errorf("%s is allowed to skip caller identity but is not in the unprovisioned-client exemption switch; a route without identity must be public in both places", path)
		}
	}
}

func TestRouteIdentityRatchetRejectsAHandlerWithoutACaller(t *testing.T) {
	files := map[string]string{"p.go": `package provider
func newApp() {
	_ = map[string]simple.AppVersionRouteHandlers{"v1": {
		simple.AppVersionRoute{Namespaced: true, Path: "/backend/ok", Method: simple.AppCustomRouteMethodGet}:      viaHelper(),
		simple.AppVersionRoute{Namespaced: true, Path: "/backend/bad", Method: simple.AppCustomRouteMethodPost}:     leaky(),
		simple.AppVersionRoute{Namespaced: true, Path: "/backend/open", Method: simple.AppCustomRouteMethodGet}:     leaky(),
	}}
}
func viaHelper() H { return func() { check() } }
func check()      { _, _ = callerNamespace() }
func leaky() H    { return func() { store.Write() } }
`}
	violations, err := routesWithoutVerifiedCaller(files, map[string]string{"/backend/open": "test"})
	if err != nil {
		t.Fatal(err)
	}
	if len(violations) != 1 || !strings.Contains(violations[0], "/backend/bad") {
		t.Fatalf("violations=%v", violations)
	}
}
