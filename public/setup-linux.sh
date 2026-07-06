#!/bin/sh
# DSPi web console -- Linux USB access setup.
#
# WebUSB can list the DSPi without any setup, but opening it requires write
# access to its /dev/bus/usb node. This installs a udev rule granting that to
# the locally-logged-in user, plus the snap/plugdev fallbacks some distros need.
#
#   curl -fsSL https://sigman78.github.io/dspi-web-console/setup-linux.sh | sh
#
# Runs read-only diagnostics first and only escalates to sudo for the steps it
# found necessary. Idempotent: safe to re-run.
set -eu

RULES_PATH=/etc/udev/rules.d/70-dspi.rules
RULES_CONTENT='# DSPi USB DSP -- grants the active local user access so WebUSB can open it.
SUBSYSTEM=="usb", ATTR{idVendor}=="2e8a", ATTR{idProduct}=="feaa", TAG+="uaccess", MODE="0660", GROUP="plugdev"
SUBSYSTEM=="usb", ATTR{idVendor}=="2e8b", ATTR{idProduct}=="feaa", TAG+="uaccess", MODE="0660", GROUP="plugdev"'

info() { printf '  %s\n' "$1"; }
fail() {
    printf 'error: %s\n' "$1" >&2
    exit 1
}

scan_device() {
    dev_found=0
    dev_accessible=0
    for d in /sys/bus/usb/devices/*; do
        [ -f "$d/idVendor" ] || continue
        v="$(cat "$d/idVendor")"
        p="$(cat "$d/idProduct" 2>/dev/null || true)"
        case "$v:$p" in
        2e8a:feaa | 2e8b:feaa)
            dev_found=1
            node="$(printf '/dev/bus/usb/%03d/%03d' "$(cat "$d/busnum")" "$(cat "$d/devnum")")"
            if [ -w "$node" ]; then dev_accessible=1; fi
            ;;
        esac
    done
}

main() {
    # ---- diagnostics (read-only, no privileges) ----
    echo "DSPi Linux USB setup -- checking prerequisites"

    [ "$(uname -s)" = "Linux" ] || fail "this script is for Linux only."

    if grep -qi microsoft /proc/version 2>/dev/null; then
        info "WSL detected: if your browser runs on Windows, no Linux setup is"
        info "needed there. Continuing for a browser inside WSL (needs usbipd)."
    fi

    command -v udevadm >/dev/null 2>&1 || fail "udevadm not found -- is this a container? udev is required."
    [ -e /run/udev/control ] || fail "udev daemon is not running -- WebUSB device access cannot work here."
    info "udev: running"

    if [ -d /run/systemd/system ]; then
        logind=1
        info "systemd-logind: present (uaccess tag will grant per-session access)"
    else
        logind=0
        info "systemd-logind: absent (relying on the plugdev group fallback)"
    fi

    as_root=0
    if [ "$(id -u)" -eq 0 ]; then as_root=1; fi
    user="${SUDO_USER:-$(id -un)}"

    need_rule=0
    if [ -f "$RULES_PATH" ] && [ "$(cat "$RULES_PATH")" = "$RULES_CONTENT" ]; then
        info "udev rule: already installed ($RULES_PATH)"
    elif [ -f "$RULES_PATH" ]; then
        need_rule=1
        info "udev rule: outdated -- will update $RULES_PATH"
    else
        need_rule=1
        info "udev rule: missing -- will install $RULES_PATH"
    fi

    need_group=0
    if [ "$logind" -eq 0 ] && [ "$user" != "root" ]; then
        if getent group plugdev >/dev/null 2>&1; then
            if id -nG "$user" | tr ' ' '\n' | grep -qx plugdev; then
                info "plugdev group: $user is a member"
            else
                need_group=1
                info "plugdev group: will add $user (fallback path, no logind)"
            fi
        else
            info "plugdev group: does not exist on this system -- skipping"
        fi
    fi

    need_snap=""
    if command -v snap >/dev/null 2>&1; then
        for s in chromium brave opera; do
            snap list "$s" >/dev/null 2>&1 || continue
            if snap connections "$s" 2>/dev/null | grep -q "$s:raw-usb.*:raw-usb"; then
                info "snap $s: raw-usb already connected"
            else
                need_snap="$need_snap $s"
                info "snap $s: will connect the raw-usb interface"
            fi
        done
    fi

    scan_device
    if [ "$dev_found" -eq 0 ]; then
        info "device: no DSPi plugged in right now"
    elif [ "$dev_accessible" -eq 1 ] && [ "$as_root" -eq 0 ]; then
        info "device: DSPi detected and already accessible"
    else
        info "device: DSPi detected"
    fi

    if [ "$need_rule" -eq 0 ] && [ "$need_group" -eq 0 ] && [ -z "$need_snap" ]; then
        echo
        if [ "$dev_found" -eq 1 ] && [ "$dev_accessible" -eq 0 ] && [ "$as_root" -eq 0 ]; then
            echo "Everything is installed but the device node is still restricted."
            echo "Replug the DSPi (the rule applies on plug-in), then reconnect."
        else
            echo "Nothing to do -- system is already set up."
            echo "Reminder: WebUSB needs a Chromium-based browser (Firefox does not support it)."
        fi
        exit 0
    fi

    # ---- apply (privileged) ----
    SUDO=""
    if [ "$as_root" -eq 0 ]; then
        command -v sudo >/dev/null 2>&1 || fail "run as root, or install sudo."
        SUDO="sudo"
        echo
        echo "Applying the changes above -- sudo may prompt."
    fi

    if [ "$need_rule" -eq 1 ]; then
        printf '%s\n' "$RULES_CONTENT" | $SUDO tee "$RULES_PATH" >/dev/null
        echo "Installed $RULES_PATH"
        $SUDO udevadm control --reload
        $SUDO udevadm trigger --subsystem-match=usb
        echo "Reloaded udev rules."
    fi

    if [ "$need_group" -eq 1 ]; then
        $SUDO usermod -aG plugdev "$user"
        echo "Added $user to the plugdev group (takes effect after re-login)."
    fi

    for s in $need_snap; do
        if $SUDO snap connect "$s:raw-usb"; then
            echo "Connected snap interface $s:raw-usb"
        fi
    done

    # ---- verify ----
    scan_device
    echo
    if [ "$dev_found" -eq 0 ]; then
        echo "Done. Plug in the DSPi and connect from the web console."
    elif [ "$dev_accessible" -eq 1 ] && [ "$as_root" -eq 1 ]; then
        echo "Done. Ran as root, so user access could not be verified directly;"
        echo "replug the DSPi and connect from the web console."
    elif [ "$dev_accessible" -eq 1 ]; then
        echo "Done. DSPi is accessible -- connect from the web console."
    else
        echo "Done. Replug the DSPi (the rule applies on plug-in), then connect."
    fi
    echo "Reminder: WebUSB needs a Chromium-based browser (Firefox does not support it)."
}

main "$@"
