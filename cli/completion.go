package main

import "fmt"

func completionScript(shell string) (string, error) {
	switch shell {
	case "bash":
		return `# bash completion for metakip
_metakip() {
  local cur prev
  COMPREPLY=()
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"
  if [[ $COMP_CWORD -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "login logout whoami doctor skill update uninstall help page folder completion" -- "$cur") )
  elif [[ ${COMP_WORDS[1]} == page && $COMP_CWORD -eq 2 ]]; then
    COMPREPLY=( $(compgen -W "list view create edit update" -- "$cur") )
  elif [[ ${COMP_WORDS[1]} == page && ${COMP_WORDS[2]} == edit && $COMP_CWORD -eq 3 ]]; then
    COMPREPLY=( $(compgen -W "interactive exact replace append prepend" -- "$cur") )
  elif [[ ${COMP_WORDS[1]} == skill && $COMP_CWORD -eq 2 ]]; then
    COMPREPLY=( $(compgen -W "install update" -- "$cur") )
  elif [[ ${COMP_WORDS[1]} == folder && $COMP_CWORD -eq 2 ]]; then
    COMPREPLY=( $(compgen -W "list" -- "$cur") )
  fi
}
complete -F _metakip metakip
`, nil
	case "zsh":
		return `#compdef metakip
_metakip() {
  local -a commands page_commands skill_commands
  commands=(login logout whoami doctor skill update uninstall help page folder completion)
  page_commands=(list view create edit update)
  skill_commands=(install update)
  if (( CURRENT == 2 )); then
    _describe 'command' commands
  elif [[ $words[2] == page && CURRENT == 3 ]]; then
    _describe 'page command' page_commands
  elif [[ $words[2] == page && $words[3] == edit && CURRENT == 4 ]]; then
    _values 'edit mode' interactive exact replace append prepend
  elif [[ $words[2] == skill && CURRENT == 3 ]]; then
    _describe 'skill command' skill_commands
  elif [[ $words[2] == folder && CURRENT == 3 ]]; then
    _values 'folder command' list
  else
    _arguments '*:argument:_files'
  fi
}
compdef _metakip metakip
`, nil
	case "fish":
		return `complete -c metakip -f
complete -c metakip -n '__fish_use_subcommand' -a 'login logout whoami doctor skill update uninstall help page folder completion'
complete -c metakip -n '__fish_seen_subcommand_from page' -a 'list view create edit update'
complete -c metakip -n '__fish_seen_subcommand_from page; and __fish_seen_subcommand_from edit' -a 'interactive exact replace append prepend'
complete -c metakip -n '__fish_seen_subcommand_from skill' -a 'install update'
complete -c metakip -n '__fish_seen_subcommand_from folder' -a 'list'
`, nil
	default:
		return "", fmt.Errorf("unsupported shell %q", shell)
	}
}
