//! MC 内核：元数据、下载、安装、启动。只有 lead 修改本目录。

pub mod download;
pub mod fabric;
pub mod java;
pub mod install;
pub mod launch;
pub mod meta;
pub mod modrinth;
pub mod paths;

/// 进度事件：内核所有长操作统一用它上报
#[derive(Debug, Clone)]
pub struct Progress {
    pub percent: f64,
    pub message: String,
    pub log: Option<String>,
}

pub type ProgressFn<'a> = &'a (dyn Fn(Progress) + Send + Sync);

pub fn pct(percent: f64, message: impl Into<String>) -> Progress {
    Progress { percent, message: message.into(), log: None }
}

pub fn logline(percent: f64, message: impl Into<String>) -> Progress {
    let m = message.into();
    Progress { percent, log: Some(m.clone()), message: m }
}

/// 离线账号
#[derive(Debug, Clone)]
pub struct OfflineAccount {
    pub name: String,
    pub uuid: String,
}

impl OfflineAccount {
    pub fn new(name: &str) -> Self {
        Self { name: name.to_string(), uuid: offline_uuid(name) }
    }
}

pub fn offline_uuid(name: &str) -> String {
    let h = md5(format!("OfflinePlayer:{name}").as_bytes());
    let mut b = h;
    b[6] = (b[6] & 0x0f) | 0x30;
    b[8] = (b[8] & 0x3f) | 0x80;
    let hex: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &hex[0..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..32])
}

/// 极简 MD5（只用于离线 UUID，不用于安全）
pub fn md5(data: &[u8]) -> [u8; 16] {
    const S: [u32; 64] = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5,
        9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10,
        15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    let mut k = [0u32; 64];
    for (i, item) in k.iter_mut().enumerate() {
        *item = ((i as f64 + 1.0).sin().abs() * 4_294_967_296.0) as u32;
    }
    let mut state: [u32; 4] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
    let mut msg = data.to_vec();
    let bit_len = (data.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_le_bytes());
    for chunk in msg.chunks(64) {
        let mut w = [0u32; 16];
        for i in 0..16 {
            w[i] = u32::from_le_bytes([chunk[i * 4], chunk[i * 4 + 1], chunk[i * 4 + 2], chunk[i * 4 + 3]]);
        }
        let (mut a, mut b, mut c, mut d) = (state[0], state[1], state[2], state[3]);
        for i in 0..64 {
            let (f, g) = match i / 16 {
                0 => ((b & c) | (!b & d), i),
                1 => ((d & b) | (!d & c), (5 * i + 1) % 16),
                2 => (b ^ c ^ d, (3 * i + 5) % 16),
                _ => (c ^ (b | !d), (7 * i) % 16),
            };
            let tmp = f.wrapping_add(a).wrapping_add(k[i]).wrapping_add(w[g]);
            a = d;
            d = c;
            c = b;
            b = b.wrapping_add(tmp.rotate_left(S[i]));
        }
        state[0] = state[0].wrapping_add(a);
        state[1] = state[1].wrapping_add(b);
        state[2] = state[2].wrapping_add(c);
        state[3] = state[3].wrapping_add(d);
    }
    let mut out = [0u8; 16];
    for (i, v) in state.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&v.to_le_bytes());
    }
    out
}
