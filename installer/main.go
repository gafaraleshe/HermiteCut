// HermiteCut — Windows installer for the DaVinci Resolve Workflow Integration plugin.
package main

import (
	"bufio"
	"embed"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
)

//go:embed all:payload
var payload embed.FS

const pluginDir = "com.hermitelabs.cut"

// Folder used by the pre-release build. Removed on install and uninstall so
// Resolve does not list two copies of the panel.
const legacyPluginDir = "com.gaffystudios.editkit.resolve"

func programData() string {
	if p := os.Getenv("PROGRAMDATA"); p != "" {
		return p
	}
	return `C:\ProgramData`
}

func supportDir() string {
	return filepath.Join(programData(), "Blackmagic Design", "DaVinci Resolve", "Support")
}

func pluginsRoot() string  { return filepath.Join(supportDir(), "Workflow Integration Plugins") }
func target() string       { return filepath.Join(pluginsRoot(), pluginDir) }
func legacyTarget() string { return filepath.Join(pluginsRoot(), legacyPluginDir) }

func bridgeCandidates() []string {
	d := filepath.Join(supportDir(), "Developer", "Workflow Integrations", "Examples")
	return []string{
		filepath.Join(d, "SamplePlugin", "WorkflowIntegration.node"),
		filepath.Join(d, "SamplePromisePlugin", "WorkflowIntegration.node"),
		filepath.Join(d, "CompatibleSamplePlugin", "WorkflowIntegration.node"),
	}
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

func resolveRunning() bool {
	out, err := exec.Command("tasklist", "/FI", "IMAGENAME eq Resolve.exe", "/NH").Output()
	if err != nil {
		return false
	}
	return strings.Contains(strings.ToLower(string(out)), "resolve.exe")
}

func pause(r *bufio.Reader) {
	fmt.Print("\n  Press Enter to close...")
	r.ReadString('\n')
}

func elevateAndExit(args ...string) {
	exe, _ := os.Executable()
	a := strings.Join(args, " ")
	ps := fmt.Sprintf("Start-Process -FilePath '%s' -ArgumentList '%s' -Verb RunAs", strings.ReplaceAll(exe, "'", "''"), a)
	if a == "" {
		ps = fmt.Sprintf("Start-Process -FilePath '%s' -Verb RunAs", strings.ReplaceAll(exe, "'", "''"))
	}
	exec.Command("powershell", "-NoProfile", "-Command", ps).Run()
	os.Exit(0)
}

func install() error {
	var bridge string
	for _, c := range bridgeCandidates() {
		if _, err := os.Stat(c); err == nil {
			bridge = c
			break
		}
	}
	if bridge == "" {
		return fmt.Errorf("could not find WorkflowIntegration.node.\n  DaVinci Resolve STUDIO (v19 or newer) must be installed - Workflow Integration plugins are a Studio feature.\n  Looked in: %s", filepath.Dir(filepath.Dir(bridgeCandidates()[0])))
	}
	dst := target()
	// clean install (ignore errors from files that are in use)
	os.RemoveAll(dst)
	if _, err := os.Stat(legacyTarget()); err == nil {
		if err := os.RemoveAll(legacyTarget()); err != nil {
			return err
		}
		fmt.Println("  Removed the old pre-release panel.")
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	n := 0
	err := fs.WalkDir(payload, "payload", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel := strings.TrimPrefix(strings.TrimPrefix(p, "payload"), "/")
		if rel == "" {
			return nil
		}
		out := filepath.Join(dst, filepath.FromSlash(rel))
		if d.IsDir() {
			return os.MkdirAll(out, 0o755)
		}
		b, err := payload.ReadFile(p)
		if err != nil {
			return err
		}
		n++
		return os.WriteFile(out, b, 0o644)
	})
	if err != nil {
		return err
	}
	if err := copyFile(bridge, filepath.Join(dst, "WorkflowIntegration.node")); err != nil {
		return fmt.Errorf("copying WorkflowIntegration.node: %w", err)
	}
	fmt.Printf("  Copied %d files + Resolve's WorkflowIntegration.node\n", n)
	return nil
}

func uninstall() error {
	if _, err := os.Stat(legacyTarget()); err == nil {
		if err := os.RemoveAll(legacyTarget()); err != nil {
			return err
		}
	}
	dst := target()
	if _, err := os.Stat(dst); os.IsNotExist(err) {
		fmt.Println("  HermiteCut is not installed.")
		return nil
	}
	return os.RemoveAll(dst)
}

func isPerm(err error) bool {
	return err != nil && (os.IsPermission(err) || strings.Contains(strings.ToLower(err.Error()), "access is denied"))
}

func main() {
	syscall.NewLazyDLL("kernel32.dll").NewProc("SetConsoleOutputCP").Call(65001)
	r := bufio.NewReader(os.Stdin)
	mode := "install"
	for _, a := range os.Args[1:] {
		switch strings.ToLower(strings.TrimLeft(a, "-/")) {
		case "uninstall", "remove", "u":
			mode = "uninstall"
		case "quiet", "q":
			mode += "-quiet"
		}
	}
	quiet := strings.HasSuffix(mode, "-quiet")
	mode = strings.TrimSuffix(mode, "-quiet")

	fmt.Println()
	fmt.Println("  ██╗  ██╗███████╗██████╗ ███╗   ███╗██╗████████╗███████╗ ██████╗██╗   ██╗████████╗")
	fmt.Println("  ██║  ██║██╔════╝██╔══██╗████╗ ████║██║╚══██╔══╝██╔════╝██╔════╝██║   ██║╚══██╔══╝")
	fmt.Println("  ███████║█████╗  ██████╔╝██╔████╔██║██║   ██║   █████╗  ██║     ██║   ██║   ██║")
	fmt.Println("  ██╔══██║██╔══╝  ██╔══██╗██║╚██╔╝██║██║   ██║   ██╔══╝  ██║     ██║   ██║   ██║")
	fmt.Println("  ██║  ██║███████╗██║  ██║██║ ╚═╝ ██║██║   ██║   ███████╗╚██████╗╚██████╔╝   ██║")
	fmt.Println("  ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝   ╚═╝   ╚══════╝ ╚═════╝ ╚═════╝    ╚═╝")
	fmt.Println("  for DaVinci Resolve Studio  ·  hermitelabs.com/cut")
	fmt.Println()

	if mode == "install" && !quiet {
		if _, err := os.Stat(target()); err == nil {
			fmt.Println("  HermiteCut is already installed.")
			fmt.Print("  [Enter] Update / reinstall    [R] Remove    [Q] Quit  > ")
			ans, _ := r.ReadString('\n')
			ans = strings.ToLower(strings.TrimSpace(ans))
			if ans == "q" {
				return
			}
			if ans == "r" {
				mode = "uninstall"
			}
		}
	}

	var err error
	if mode == "uninstall" {
		fmt.Println("  Removing HermiteCut...")
		err = uninstall()
	} else {
		fmt.Println("  Installing to:")
		fmt.Println("  " + target())
		err = install()
	}
	if isPerm(err) {
		fmt.Println("  Windows needs administrator permission for this folder - asking now...")
		if mode == "uninstall" {
			elevateAndExit("/uninstall")
		}
		elevateAndExit()
	}
	if err != nil {
		fmt.Println("\n  ✗ " + err.Error())
		if !quiet {
			pause(r)
		}
		os.Exit(1)
	}
	if mode == "uninstall" {
		fmt.Println("\n  ✓ Removed. Restart DaVinci Resolve to update the menu.")
	} else {
		fmt.Println("\n  ✓ Installed!")
		fmt.Println()
		if resolveRunning() {
			fmt.Println("  DaVinci Resolve is running: quit and reopen it once so it finds the plugin.")
		}
		fmt.Println("  Open it from:  Workspace > Workflow Integrations > HermiteCut")
	}
	if !quiet {
		pause(r)
	}
}
