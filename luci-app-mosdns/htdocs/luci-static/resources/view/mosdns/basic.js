'use strict';
'require form';
'require fs';
'require poll';
'require rpc';
'require uci';
'require ui';
'require view';

const callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: ['name'],
	expect: { '': {} }
});

function getServiceStatus() {
	return L.resolveDefault(callServiceList('mosdns'), {}).then(res => {
		let isRunning = false;
		try {
			isRunning = res['mosdns']['instances']['mosdns']['running'];
		} catch (e) { }
		return isRunning;
	});
}

function renderStatus(isRunning) {
	const spanTemp = '<em><span style="color:%s"><strong>%s %s</strong></span></em>';
	let renderHTML;
	if (isRunning) {
		renderHTML = spanTemp.format('green', _('MosDNS'), _('RUNNING'));
	} else {
		renderHTML = spanTemp.format('red', _('MosDNS'), _('NOT RUNNING'));
	}

	return renderHTML;
}

async function loadCodeMirrorResources() {
	const styles = [
		'/luci-static/resources/codemirror5/theme/dracula.min.css',
		'/luci-static/resources/codemirror5/addon/lint/lint.min.css',
		'/luci-static/resources/codemirror5/codemirror.min.css',
	];
	const scripts = [
		'/luci-static/resources/codemirror5/libs/js-yaml.min.js',
		'/luci-static/resources/codemirror5/codemirror.min.js',
		'/luci-static/resources/codemirror5/addon/display/autorefresh.min.js',
		'/luci-static/resources/codemirror5/mode/yaml/yaml.min.js',
		'/luci-static/resources/codemirror5/addon/lint/lint.min.js',
		'/luci-static/resources/codemirror5/addon/lint/yaml-lint.min.js',
	];
	const loadStyles = async () => {
		for (const href of styles) {
			const link = document.createElement('link');
			link.rel = 'stylesheet';
			link.href = href;
			document.head.appendChild(link);
		}
	};
	const loadScripts = async () => {
		for (const src of scripts) {
			const script = document.createElement('script');
			script.src = src;
			document.head.appendChild(script);
			await new Promise(resolve => script.onload = resolve);
		}
	};
	await loadStyles();
	await loadScripts();
}

const callMosdns = rpc.declare({
	object: 'luci.mosdns',
	method: 'get_version',
	expect: { '': {} }
});

return view.extend({
	load() {
		return Promise.all([
			L.resolveDefault(callMosdns(), null),
		]);
	},

	render(data) {
		let m, s, o;

		const version = (data[0] && data[0].version) ? data[0].version : '';
		m = new form.Map('mosdns', _('MosDNS') + ' ' + version,
			_('MosDNS is a plugin-based DNS forwarder/traffic splitter.'));

		s = m.section(form.TypedSection);
		s.anonymous = true;
		s.render = () => {
			setTimeout(() => {
				poll.add(() => {
					return L.resolveDefault(getServiceStatus()).then(res => {
						const view = document.getElementById('service_status');
						if (view) {
							view.innerHTML = renderStatus(res);
						} else {
							console.error('Element #service_status not found.');
						}
					});
				});
			}, 100);

			/* dynamically loading Codemirror resources */
			loadCodeMirrorResources();

			return E('div', { class: 'cbi-section', id: 'status_bar' }, [
				E('p', { id: 'service_status' }, _('Collecting data...'))
			]);
		};

		s = m.section(form.NamedSection, 'config', 'mosdns');

		s.tab('basic', _('Basic Options'));
		s.tab('advanced', _('Advanced Options'));

		/* basic */
		o = s.taboption('basic', form.Flag, 'enabled', _('Enabled'));
		o.default = o.disabled;
		o.rmempty = false;

		o = s.taboption('basic', form.Button, '_restart_btn', _('Restart service'),
			_('mosdns v5 requires a service restart to apply configuration changes.'));
		o.inputtitle = _('Restart MosDNS');
		o.inputstyle = 'negative';
		o.write = function() {};
		o.remove = function() {};
		o.onclick = function(ev, section_id) {
			return fs.exec('/etc/init.d/mosdns', ['restart'])
				.then(() => {
					ui.addNotification(null, E('p', _('mosdns has been restarted, the new configuration is now active.')), 'info');
				})
				.catch(e => {
					ui.addNotification(null, E('p', _('Failed to restart: %s').format(e.message)), 'error');
				});
		};

		o = s.taboption('basic', form.ListValue, 'configfile', _('Config File'));
		o.value('/etc/mosdns/config_custom.yaml', _('Custom Config'));
		o.default = '/etc/mosdns/config_custom.yaml';
		o.rmempty = false;

		o = s.taboption('basic', form.Value, 'listen_port', _('Listen Port'));
		o.default = '5335';
		o.datatype = 'port';
		o.depends('configfile', '/var/etc/mosdns.json');

		o = s.taboption('basic', form.Value, 'listen_address', _('Listen Address'));
		o.default = '0.0.0.0';
		o.depends('configfile', '/var/etc/mosdns.json');

		o = s.taboption('basic', form.ListValue, 'log_level', _('Log Level'));
		o.value('debug', _('Debug'));
		o.value('info', _('Info'));
		o.value('warn', _('Warning'));
		o.value('error', _('Error'));
		o.default = 'error';
		o.depends('configfile', '/var/etc/mosdns.json');

		o = s.taboption('basic', form.Value, 'log_file', _('Log File'));
		o.placeholder = '/var/log/mosdns.log';
		o.default = '/var/log/mosdns.log';
		o.depends('configfile', '/var/etc/mosdns.json');
		o.rmempty = false;

		o = s.taboption('basic', form.Value, 'log_size', _('Log File Size'), _('Set the maximum size of the log file (in MB).'));
		o.datatype = 'uinteger';
		o.default = '1';
		o.depends('configfile', '/var/etc/mosdns.json');

		o = s.taboption('basic', form.Flag, 'redirect', _('DNS Forward'), _('Forward Dnsmasq Domain Name resolution requests to MosDNS'));
		o.default = false;

		if (L.hasSystemFeature('firewall4')) {
			o = s.taboption('basic', form.Flag, 'local_dns_redirect', _('DNS redirect'), _('Force redirect all local DNS queries to MosDNS, a.k.a. DNS Hijacking'));
			o.default = false;
			o.depends('redirect', '1');
		}

		/* advanced */
		o = s.taboption('advanced', form.Value, 'concurrent', _('Concurrent'),
			_('DNS query request concurrency, The number of upstream DNS servers that are allowed to initiate requests at the same time'));
		o.datatype = 'and(uinteger,min(1),max(3))';
		o.default = '2';
		o.depends('configfile', '/var/etc/mosdns.json');

		o = s.taboption('advanced', form.Value, 'idle_timeout', _('Idle Timeout'),
			_('DoH/TCP/DoT Connection Multiplexing idle timeout (default 30 seconds)'));
		o.datatype = 'and(uinteger,min(1))';
		o.default = '30';
		o.depends('configfile', '/var/etc/mosdns.json');

		o = s.taboption('advanced', form.Flag, 'enable_pipeline', _('TCP/DoT Connection Multiplexing'),
			_('Enable TCP/DoT RFC 7766 new Query Pipelining connection multiplexing mode'));
		o.rmempty = false;
		o.default = false;
		o.depends('configfile', '/var/etc/mosdns.json');

		o = s.taboption('advanced', form.Flag, 'insecure_skip_verify', _('Disable TLS Certificate'),
			_('Disable TLS Servers certificate validation, Can be useful if system CA certificate expires or the system time is out of order'));
		o.rmempty = false;
		o.default = false;
		o.depends('configfile', '/var/etc/mosdns.json');

		o = s.taboption('advanced', form.Flag, 'enable_ecs_remote',
			_('Enable EDNS client subnet'));
		o.rmempty = false;
		o.default = false;
		o.depends('configfile', '/var/etc/mosdns.json');

		o = s.taboption('advanced', form.Value, 'remote_ecs_ip', _('IP Address'),
			_('Please provide the IP address you use when accessing foreign websites. This IP subnet (0/24) will be used as the ECS address for Remote / Streaming Media DNS requests') +
			_('This feature is typically used when using a self-built DNS server as an Remote / Streaming Media DNS upstream (requires support from the upstream server)'));
		o.datatype = 'ipaddr';
		o.depends('enable_ecs_remote', '1');

		o = s.taboption('advanced', form.Flag, 'dns_leak', _('Prevent DNS Leaks'),
			_('Enable this option fallback policy forces forwarding to remote DNS'));
		o.rmempty = false;
		o.default = false;
		o.depends('configfile', '/var/etc/mosdns.json');

		o = s.taboption('advanced', form.Flag, 'cache', _('Enable DNS Cache'));
		o.rmempty = false;
		o.default = false;
		o.depends('configfile', '/var/etc/mosdns.json');

		o = s.taboption('advanced', form.Value, 'cache_size', _('DNS Cache Size'));
		o.datatype = 'and(uinteger,min(0))';
		o.default = 8000;
		o.depends('cache', '1');

		o = s.taboption('advanced', form.Value, 'lazy_cache_ttl', _('Lazy Cache TTL'),
			_('Lazy cache survival time (in second). To disable Lazy Cache, please set to 0.'));
		o.datatype = 'and(uinteger,min(0))';
		o.default = 86400;
		o.depends('cache', '1');

		o = s.taboption('advanced', form.Flag, 'prefetch', _('Cache Prefetching'),
			_('Proactively refresh hot cache entries in the background before they expire.'));
		o.rmempty = false;
		o.default = false;
		o.depends('cache', '1');

		o = s.taboption('advanced', form.Value, 'prefetch_before_expire', _('Prefetch Before Expire'),
			_('Prefetch when the remaining TTL is less than this value (in seconds).'));
		o.datatype = 'and(uinteger,min(1))';
		o.default = 10;
		o.depends('prefetch', '1');

		o = s.taboption('advanced', form.Value, 'prefetch_min_hits', _('Prefetch Min Hits'),
			_('Minimum cache hits required since the last refresh to trigger a prefetch.'));
		o.datatype = 'and(uinteger,min(1))';
		o.default = 3;
		o.depends('prefetch', '1');

		o = s.taboption('advanced', form.Value, 'prefetch_scan_interval', _('Prefetch Scan Interval'),
			_('Interval for the background thread to scan the cache for prefetching (in seconds).'));
		o.datatype = 'and(uinteger,min(1))';
		o.default = 5;
		o.depends('prefetch', '1');

		o = s.taboption('advanced', form.Flag, 'dump_file', _('Cache Dump'),
			_('Save the cache locally and reload the cache dump on the next startup'));
		o.rmempty = false;
		o.default = false;
		o.depends('cache', '1');

		o = s.taboption('advanced', form.Value, 'dump_interval',
			_('Auto Save Cache Interval'));
		o.datatype = 'and(uinteger,min(0))';
		o.default = 3600;
		o.depends('dump_file', '1');

		o = s.taboption('advanced', form.Value, 'minimal_ttl', _('Minimum TTL'),
			_('Modify the Minimum TTL value (seconds) for DNS answer results, 0 indicating no modification'));
		o.datatype = 'and(uinteger,min(0),max(604800))';
		o.default = 0;
		o.depends('configfile', '/var/etc/mosdns.json');

		o = s.taboption('advanced', form.Value, 'maximum_ttl', _('Maximum TTL'),
			_('Modify the Maximum TTL value (seconds) for DNS answer results, 0 indicating no modification'));
		o.datatype = 'and(uinteger,min(0),max(604800))';
		o.default = 0;
		o.depends('configfile', '/var/etc/mosdns.json');

		o = s.taboption('advanced', form.Flag, 'reject_type65', _('Disable RR Type 65 (HTTPS/SVCB)'),
			_('Block DNS RR Type 65 records (HTTPS/SVCB, used for HTTP/3, ECH, etc.), force using only A/AAAA records.'));
		o.default = 0;
		o.depends('configfile', '/var/etc/mosdns.json');

		o = s.taboption('advanced', form.Flag, 'adblock', _('Enable DNS ADblock'),
			_('Download rule sources into /etc/mosdns/rule/ for your custom config to reference.'));
		o.depends('configfile', '/etc/mosdns/config_custom.yaml');
		o.default = false;

		o = s.taboption('advanced', form.DynamicList, 'ad_source', _('ADblock Source'),
			_('When using custom rule sources, please use rule types supported by MosDNS (domain list or AdGuardHome rules).') +
			'<br>' +
			_('Support for local files, such as: file:///var/mosdns/example.txt'));
		o.depends('adblock', '1');
		o.default = 'https://raw.githubusercontent.com/privacy-protection-tools/anti-AD/master/anti-ad-domains.txt';
		o.value('https://raw.githubusercontent.com/privacy-protection-tools/anti-AD/master/anti-ad-domains.txt', 'anti-AD');
		o.value('https://raw.githubusercontent.com/Cats-Team/AdRules/main/mosdns_adrules.txt', 'Cats-Team/AdRules');
		o.value('https://raw.githubusercontent.com/neodevpro/neodevhost/master/domain', 'NEO DEV HOST');

		o = s.taboption('advanced', form.Value, 'github_proxy', _('GitHub Proxy'),
			_('Update rule files with GitHub Proxy, leave blank to disable proxy downloads.'));
		o.value('https://gh-proxy.com', _('https://gh-proxy.com'));
		o.rmempty = true;
		o.default = '';
		o.depends('adblock', '1');

		/* configuration */
		let configeditor = null;
		setTimeout(() => {
			const textarea = document.getElementById('widget.cbid.mosdns.config._custom');
			if (textarea) {
				configeditor = CodeMirror.fromTextArea(textarea, {
					autoRefresh: true,
					lineNumbers: true,
					lineWrapping: true,
					lint: true,
					gutters: ['CodeMirror-lint-markers'],
					matchBrackets: true,
					mode: 'text/yaml',
					styleActiveLine: true,
					theme: 'dracula'
				});
			}
		}, 600);
		o = s.taboption('basic', form.TextValue, '_custom', _('Configuration Editor'),
			_('This is the content of the file \'/etc/mosdns/config_custom.yaml\' from which your MosDNS configuration will be generated. \
			Only accepts configuration content in yaml format.'));
		o.rows = 25;
		o.depends('configfile', '/etc/mosdns/config_custom.yaml');
		o.cfgvalue = section_id => fs.trimmed('/etc/mosdns/config_custom.yaml');
		o.write = function(section_id, formvalue) {
			if (configeditor) {
				const editorContent = configeditor.getValue();
				if (editorContent === formvalue) {
					return;
				}
				return fs.write('/etc/mosdns/config_custom.yaml', editorContent.trim().replace(/\r\n/g, '\n') + '\n')
					.then(i => fs.exec('/etc/init.d/mosdns', ['restart']))
					.then(() => window.location.reload())
					.catch(e => {
						ui.addNotification(null, E('p', _('Unable to save contents: %s').format(e.message)));
					});
			}
		};

		return m.render();
	}
});
