package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"runtime/debug"
	"strings"
	"syscall"

	"github.com/alecthomas/kong"
)

var (
	version = "dev"
	commit  = ""
)

func buildVersion() string {
	result := version
	if result == "dev" {
		if info, ok := debug.ReadBuildInfo(); ok && info.Main.Version != "" && info.Main.Version != "(devel)" {
			result = info.Main.Version
		}
	}
	if commit != "" {
		short := commit
		if len(short) > 7 {
			short = short[:7]
		}
		result += " (" + short + ")"
	}
	return result
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cli := CLI{}
	parser, err := kong.New(
		&cli,
		kong.Name("metakip"),
		kong.Description("Read and edit Metakip pages from the terminal."),
		kong.UsageOnError(),
		kong.ConfigureHelp(kong.HelpOptions{Compact: true, Summary: true}),
		kong.Vars{"version": buildVersion()},
	)
	if err != nil {
		fmt.Fprintln(os.Stderr, terminalText(formatHumanError(err.Error())))
		os.Exit(exitInternal)
	}
	arguments := os.Args[1:]
	if len(arguments) > 0 && arguments[0] == "help" {
		arguments = append(arguments[1:], "--help")
	}
	parsed, err := parser.Parse(normalizeLegacyPageEditArguments(arguments))
	if err != nil {
		if hasJSONFlag(arguments) {
			_ = json.NewEncoder(os.Stdout).Encode(jsonErrorEnvelope{
				Error: jsonError{Code: "invalid_arguments", Message: err.Error()},
			})
		} else {
			fmt.Fprintln(os.Stderr, terminalText(formatHumanError(err.Error())))
			var parseError *kong.ParseError
			if errors.As(err, &parseError) && parseError.Context != nil {
				_ = parseError.Context.PrintUsage(false)
			}
		}
		os.Exit(exitUsage)
	}
	runtime := newRuntime(ctx, &cli, os.Stdin, os.Stdout, os.Stderr)
	err = parsed.Run(runtime)
	if err == nil {
		return
	}
	os.Exit(reportRunError(runtime, err))
}

func normalizeLegacyPageEditArguments(arguments []string) []string {
	for index := 0; index+2 < len(arguments); index++ {
		if arguments[index] != "page" || arguments[index+1] != "edit" {
			continue
		}
		titleIndex := index + 2
		if !isReservedPageEditTitle(arguments[titleIndex]) ||
			!hasOnlyLegacyInteractiveFlags(arguments[titleIndex+1:]) {
			return arguments
		}
		normalized := make([]string, 0, len(arguments)+1)
		normalized = append(normalized, arguments[:titleIndex]...)
		normalized = append(normalized, "interactive")
		normalized = append(normalized, arguments[titleIndex:]...)
		return normalized
	}
	return arguments
}

func isReservedPageEditTitle(value string) bool {
	switch value {
	case "interactive", "exact", "replace", "append", "prepend":
		return true
	default:
		return false
	}
}

func hasOnlyLegacyInteractiveFlags(arguments []string) bool {
	for index := 0; index < len(arguments); index++ {
		argument := arguments[index]
		switch argument {
		case "--json", "-j", "--plain", "--no-input":
			continue
		case "--editor", "--url", "--timeout":
			index++
			if index >= len(arguments) || strings.HasPrefix(arguments[index], "-") {
				return false
			}
			continue
		}
		if strings.HasPrefix(argument, "--editor=") ||
			strings.HasPrefix(argument, "--url=") ||
			strings.HasPrefix(argument, "--timeout=") {
			continue
		}
		return false
	}
	return true
}

func reportRunError(runtime *runtimeState, err error) int {
	var renderedError *cliError
	if errors.As(err, &renderedError) && renderedError.AlreadyRendered {
		return exitCode(err)
	}
	// A canceled mutation may have reached the server. Preserve a typed
	// uncertain outcome instead of reducing it to an interruption.
	if errors.As(err, &renderedError) && renderedError.OutcomeUncertain {
		runtime.printError(err)
		return exitCode(err)
	}
	if errors.Is(err, context.Canceled) {
		fmt.Fprintln(runtime.stderr, terminalText(formatHumanError("Interrupted.")))
		return exitInterrupted
	}
	runtime.printError(err)
	return exitCode(err)
}

func hasJSONFlag(arguments []string) bool {
	for _, argument := range arguments {
		if argument == "--json" || argument == "-j" {
			return true
		}
	}
	return false
}
