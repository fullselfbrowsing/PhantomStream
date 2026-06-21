// PhantomStream renderer: pure fail-closed asset-origin classifier.
//
// v2.0 (Phase 12, MSEC-01) changes the viewer's verb from render-inert to
// FETCH: a mirrored <img>/<source>/poster/background-image causes the
// viewer's own browser to issue a GET from the viewer's (possibly
// privileged) network. This module is the SEPARATE fetch control that
// decides which asset origins the viewer may reach. It is distinct from the
// injection control hasDangerousScheme (sanitize.js): that one asks "can
// this URL execute script?"; this one asks "is this origin safe for the
// viewer to FETCH?" -- http(s) to an internal host (169.254.169.254,
// 10.x, an unqualified intranet name) passes the injection check yet is a
// blind-SSRF/tracking surface, which is exactly what this classifier blocks.
//
// Pure by contract: no DOM access, no network, no module-level side effects.
// new URL(...) is the only platform dependency (already load-bearing in the
// capture core's absolutifyUrl). This purity is deliberate so Phase 15
// (asset/media URL masking) can reuse the very same classifier seam against
// which it completes the masking vocabulary.
//
// Fail-closed and loud: anything not provably public-https -- a parse error,
// a non-https scheme, a private/internal/loopback/link-local/ULA host, or an
// unqualified/.local name -- returns { allowed: false, reason }. The default
// posture is conservative; the host WIDENS it via the renderer's
// assetOriginPolicy hook / allowAssetOrigins allowlist (see index.js
// gateAssetUrl), never by relaxing this function.
//
// Denylist (12-CONTEXT, locked): scheme MUST be https:; deny localhost,
// 0.0.0.0/8 ("this host", RFC 1122 -- SSRF to loopback on Linux),
// 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16,
// ::1, fc00::/7 (fc.. or fd..), and .local / unqualified (dotless) hosts.

/**
 * @typedef {Object} AssetOriginVerdict
 * @property {boolean} allowed True only for a provably public https origin.
 * @property {string}  reason  One of 'ok' | 'bad-scheme' | 'private-host'
 *   | 'unqualified-host' | 'parse-error'.
 */

/**
 * True when a (lowercased) hostname names a private, internal, loopback,
 * link-local, or ULA address -- i.e. a host the viewer must never fetch from
 * by default. Pure string/regex logic over the fixed, fully-enumerable
 * denylist (RFC1918 + RFC3927 link-local + loopback + RFC4193 ULA + the
 * mDNS .local suffix); a dependency-free hand-roll is preferred here over an
 * IP library so the predicate stays Phase-15-reusable and table-testable.
 *
 * Bracketed IPv6 literals: WHATWG URL keeps the surrounding brackets on
 * u.hostname (verified: new URL('https://[::1]/').hostname === '[::1]'), so
 * the brackets are stripped here before the IPv6 checks match the bare
 * address form. (.local is intentionally NOT handled here -- it is the
 * unqualified-host branch's job in classifyAssetOrigin so a *.local name
 * classifies as 'unqualified-host', not 'private-host'.)
 *
 * SELF-CONTAINED NORMALIZATION (Phase 12 review CR-01/WR-01): this predicate
 * is an exported Phase-15-reusable seam, so it must NOT depend on the caller
 * having pre-normalized the host through WHATWG `new URL()`. A single trailing
 * dot (the FQDN root label -- 'localhost.', '127.0.0.1.') is stripped, the host
 * is lowercased, and any IPv6 zone-id ('%eth0') is dropped here so a raw
 * `Host:` header / CSS url() host / media URL host cannot bypass the deny
 * decision. Beyond the IPv4 dotted-quad ranges this blocks IPv6 loopback
 * (`::1`), the unspecified address (`::`), link-local fe80::/10, ULA fc00::/7,
 * the NAT64 well-known prefix 64:ff9b::/96, and IPv4-mapped / IPv4-compatible
 * IPv6 (`::ffff:a.b.c.d`, `::ffff:HHHH:HHHH`, `::a.b.c.d`) by extracting the
 * embedded IPv4 and re-running the v4 ranges -- so the AWS/GCP/Azure metadata
 * host 169.254.169.254 and 127.0.0.1 are blocked in every representation. The
 * milestone has no use case for fetching from a raw IP literal, so this stays
 * fail-closed: an IP-literal form it cannot confidently prove public is denied.
 *
 * @param {string} host Lowercased hostname (u.hostname) OR a raw host string.
 * @returns {boolean}
 */
export function isPrivateOrLocalHost(host) {
  if (!host || typeof host !== 'string') return true; // fail closed on no host
  // Normalize independent of any caller pre-normalization (CR-01/WR-01):
  // lowercase, then strip a single trailing FQDN-root dot so 'localhost.' and
  // '127.0.0.1.' cannot slip past the equality/regex checks below.
  var normalized = host.toLowerCase();
  if (normalized.length > 1 && normalized.charAt(normalized.length - 1) === '.') {
    normalized = normalized.slice(0, -1);
  }
  if (normalized === 'localhost') return true;
  // Strip the brackets WHATWG URL keeps on IPv6 literal hostnames so the
  // bare-address IPv6 checks below match ('[::1]' -> '::1'), then drop any
  // IPv6 zone-id ('fe80::1%eth0' -> 'fe80::1') so a scoped literal cannot
  // bypass the prefix checks.
  var bare = normalized.charAt(0) === '[' && normalized.charAt(normalized.length - 1) === ']'
    ? normalized.slice(1, -1)
    : normalized;
  var zone = bare.indexOf('%');
  if (zone !== -1) bare = bare.slice(0, zone);
  // IPv4 dotted-quad ranges.
  var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(bare);
  if (m) {
    var a = +m[1], b = +m[2];
    if (a === 0) return true;                          // 0.0.0.0/8 "this host" (RFC 1122) -- SSRF to loopback-bound services on Linux
    if (a === 127) return true;                       // 127.0.0.0/8 loopback
    if (a === 10) return true;                         // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
    if (a === 192 && b === 168) return true;           // 192.168.0.0/16
    if (a === 169 && b === 254) return true;           // 169.254.0.0/16 link-local
    return false;
  }
  // Everything below is an IPv6 literal (colon-bearing) or a name; only the
  // IPv6 forms are denied here. A name with no colon falls through to false
  // (the dotless/.local check lives in classifyAssetOrigin).
  if (bare.indexOf(':') === -1) return false;
  if (bare === '::1') return true;                    // IPv6 loopback
  if (bare === '::') return true;                     // unspecified address
  // IPv6 link-local fe80::/10 (first hextet fe80..febf).
  if (/^fe[89ab][0-9a-f]*:/.test(bare)) return true;
  // IPv6 ULA fc00::/7 (fc.. or fd.. prefix).
  if (/^f[cd][0-9a-f]*:/.test(bare)) return true;
  // NAT64 well-known prefix 64:ff9b::/96 -- a public resolver maps an embedded
  // IPv4 (incl. the metadata host: 64:ff9b::a9fe:a9fe) here. Block the prefix
  // outright; the milestone never fetches via NAT64 by raw literal.
  if (/^64:ff9b:/.test(bare)) return true;
  // IPv4-mapped / IPv4-compatible IPv6: ::ffff:a.b.c.d, ::ffff:HHHH:HHHH,
  // or ::a.b.c.d. Extract the trailing embedded IPv4 (dotted, or the last two
  // hextets) and re-run the v4 ranges so e.g. ::ffff:169.254.169.254 and
  // ::ffff:7f00:1 (127.0.0.1) are denied through the same table.
  var mapped = /^(?:::ffff:|::)(?:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(bare);
  if (mapped) {
    var v4 = mapped[1];
    if (!v4 && mapped[2] && mapped[3]) {
      var hi = parseInt(mapped[2], 16), lo = parseInt(mapped[3], 16);
      v4 = (hi >> 8) + '.' + (hi & 255) + '.' + (lo >> 8) + '.' + (lo & 255);
    }
    // Re-run the v4 ranges on the embedded address; ::ffff:0:0/96 mapping a
    // public v4 stays allowed only when that v4 is itself public.
    if (v4 && isPrivateOrLocalHost(v4)) return true;
  }
  return false;
}

/**
 * Classify an asset URL for viewer-side fetch (MSEC-01). Fail-closed: every
 * branch that is not "a provably public https host" returns allowed:false
 * with a machine-readable reason. The reasons are stable identifiers the
 * renderer maps to a dimensioned blocked-origin placeholder and that the
 * asset-policy table test pins.
 *
 *   parse failure              -> { allowed:false, reason:'parse-error' }
 *   protocol !== 'https:'      -> { allowed:false, reason:'bad-scheme' }
 *   private/internal/ULA host  -> { allowed:false, reason:'private-host' }
 *   dotless or *.local host    -> { allowed:false, reason:'unqualified-host' }
 *   otherwise                  -> { allowed:true,  reason:'ok' }
 *
 * Note this is a FETCH gate, not an injection gate; http: is blocked here
 * (mixed-content / no-TLS) even though hasDangerousScheme would allow it.
 *
 * @param {string} url Absolute asset URL (already absolutified by capture).
 * @returns {AssetOriginVerdict}
 */
export function classifyAssetOrigin(url) {
  var u;
  try {
    u = new URL(String(url));
  } catch (e) {
    return { allowed: false, reason: 'parse-error' };
  }
  if (u.protocol !== 'https:') return { allowed: false, reason: 'bad-scheme' };
  var host = (u.hostname || '').toLowerCase();
  if (isPrivateOrLocalHost(host)) return { allowed: false, reason: 'private-host' };
  // A bracketed IPv6 literal is qualified by construction (any non-private
  // IPv6 already fell through isPrivateOrLocalHost); only its dotless form
  // would otherwise trip the unqualified check, so exempt it explicitly.
  var isIpv6Literal = host.charAt(0) === '[' && host.charAt(host.length - 1) === ']';
  if (!isIpv6Literal && (host.indexOf('.') === -1 || host.endsWith('.local'))) {
    return { allowed: false, reason: 'unqualified-host' };
  }
  return { allowed: true, reason: 'ok' };
}
