#!/usr/bin/env ucode

'use strict';

import { popen, mkdir, unlink, writefile, open, stat, stdout } from 'fs';
import { cursor } from 'uci';
import { connect } from 'ubus';

function to_array(val) {
	let res =[];
	if (type(val) == 'array') {
		for (let i = 0; i < length(val); i++) {
			if (type(val[i]) == 'string') {
				let s = replace(val[i], /^\s+|\s+$/g, '');
				if (s != "") push(res, s);
			}
		}
	} else if (type(val) == 'string') {
		let parts = split(val, /[ \t\n]+/);
		for (let i = 0; i < length(parts); i++) {
			if (parts[i] != "") push(res, parts[i]);
		}
	}
	return res;
}

function exec_sys(cmd) {
	let p = popen(cmd + " 2>&1", "r");
	if (!p) return { code: -1, stdout: "" };
	let stdout = p.read("all");
	let code = p.close();
	if (type(stdout) == 'string') {
		stdout = replace(stdout, /^\s+|\s+$/g, '');
	}
	return { code: code, stdout: stdout || "" };
}

function interface_dns() {
	let uci_cursor = cursor();
	uci_cursor.load('mosdns');
	let dns_list =[];

	if (uci_cursor.get('mosdns', 'config', 'custom_local_dns') === '1') {
		dns_list = to_array(uci_cursor.get('mosdns', 'config', 'local_dns'));
	} else {
		uci_cursor.load('network');
		let peerdns = uci_cursor.get('network', 'wan', 'peerdns');
		let proto = uci_cursor.get('network', 'wan', 'proto');

		if (peerdns === '0' || proto === 'static') {
			dns_list = to_array(uci_cursor.get('network', 'wan', 'dns'));
		} else {
			let ubus_conn = connect();
			if (ubus_conn) {
				let status = ubus_conn.call('network.interface.wan', 'status');
				if (status && type(status['dns-server']) == 'array' && length(status['dns-server']) > 0) {
					dns_list = status['dns-server'];
				}
			}
		}
	}

	if (length(dns_list) === 0) {
		dns_list =['119.29.29.29', '223.5.5.5'];
	}
	print(join(" ", dns_list) + "\n");
}

function get_adlist() {
	let uci_cursor = cursor();
	uci_cursor.load('mosdns');
	let adblock = uci_cursor.get('mosdns', 'config', 'adblock');

	if (adblock !== '1') {
		mkdir('/var/mosdns', 0755);
		exec_sys('rm -rf /etc/mosdns/rule/adlist /etc/mosdns/rule/.ad_source');
		writefile('/var/mosdns/disable-ads.txt', '');
		print("/var/mosdns/disable-ads.txt\n");
		return;
	}

	mkdir('/etc/mosdns/rule/adlist', 0755);
	let ad_source = to_array(uci_cursor.get('mosdns', 'config', 'ad_source'));
	let adlist =[];

	for (let i = 0; i < length(ad_source); i++) {
		let url = ad_source[i];
		if (!url) continue;

		if (index(url, 'file://') === 0) {
			push(adlist, substr(url, 7));
		} else {
			let parts = split(url, '/');
			let filename = parts[length(parts) - 1];
			let local_path = `/etc/mosdns/rule/adlist/${filename}`;
			if (!stat(local_path)) {
				writefile(local_path, '');
			}
			push(adlist, local_path);
		}
	}
	print(join("\n", adlist) + "\n");
}

function update_adlist() {
	let uci_cursor = cursor();
	uci_cursor.load('mosdns');

	if (uci_cursor.get('mosdns', 'config', 'adblock') !== '1') {
		return false;
	}

	let lock_file = '/var/lock/mosdns_ad_update.lock';
	let ad_source = to_array(uci_cursor.get('mosdns', 'config', 'ad_source'));
	let github_proxy = uci_cursor.get('mosdns', 'config', 'github_proxy') || '';

	mkdir('/etc/mosdns/rule', 0755);
	writefile('/etc/mosdns/rule/.ad_source', '');

	if (stat(lock_file)) return false;
	writefile(lock_file, '');

	let tmp_res = exec_sys('mktemp -d');
	if (tmp_res.code !== 0) {
		unlink(lock_file);
		die("Failed to create temp directory for adlist.");
	}
	let ad_tmpdir = tmp_res.stdout;
	let has_update = false;
	let download_failed = false;

	for (let i = 0; i < length(ad_source); i++) {
		let url = ad_source[i];
		if (!url) continue;

		if (index(url, 'file://') !== 0) {
			has_update = true;
			exec_sys(`echo "${url}" >> /etc/mosdns/rule/.ad_source`);

			let parts = split(url, '/');
			let filename = parts[length(parts) - 1];
			let mirror = "";

			if (match(url, /^https:\/\/raw\.githubusercontent\.com/)) {
				mirror = github_proxy ? github_proxy + '/' : '';
			}

			print(`Downloading ${mirror}${url}\n`);
			stdout.flush();
			let dl_res = exec_sys(`wget -4 -q --no-check-certificate -T 90 -O "${ad_tmpdir}/${filename}" "${mirror}${url}"`);
			if (dl_res.code !== 0) download_failed = true;
		}
	}

	if (download_failed) {
		exec_sys(`rm -rf "${ad_tmpdir}"`);
		unlink(lock_file);
		die("Rules download failed.");
	} else {
		if (has_update) {
			mkdir('/etc/mosdns/rule/adlist', 0755);
			exec_sys('rm -rf /etc/mosdns/rule/adlist/*');
			exec_sys(`cp "${ad_tmpdir}"/* /etc/mosdns/rule/adlist/`);
		}
	}

	exec_sys(`rm -rf "${ad_tmpdir}"`);
	unlink(lock_file);

	return has_update;
}


let action = ARGV[0];

switch (action) {
	case "interface_dns":
		interface_dns();
		break;
	case "get_adlist":
		get_adlist();
		break;
	case "update":
		if (stat('/var/lock/mosdns_update.lock')) {
			print("Another update is already in progress.\n");
			exit(1);
		}
		writefile('/var/lock/mosdns_update.lock', '');
		try {
			update_adlist();
			print("UPDATE_FINISHED\n");
			stdout.flush();
		} catch (e) {
			print("Update failed: " + e + "\n");
			print("UPDATE_EXITED\n");
			stdout.flush();
			unlink('/var/lock/mosdns_update.lock');
			exit(1);
		}
		unlink('/var/lock/mosdns_update.lock');
		break;
	case "update_adlist":
		update_adlist();
		break;
	default:
		exit(0);
}
