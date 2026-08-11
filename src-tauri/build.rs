use std::{env, fs, path::PathBuf};

fn push_u16(bytes: &mut Vec<u8>, value: u16) {
    bytes.extend_from_slice(&value.to_le_bytes());
}

fn push_u32(bytes: &mut Vec<u8>, value: u32) {
    bytes.extend_from_slice(&value.to_le_bytes());
}

fn technical_icon() -> Vec<u8> {
    const SIZE: u32 = 16;
    const IMAGE_SIZE: u32 = 40 + (SIZE * SIZE * 4) + (SIZE * 4);
    let mut icon = Vec::with_capacity((22 + IMAGE_SIZE) as usize);

    push_u16(&mut icon, 0);
    push_u16(&mut icon, 1);
    push_u16(&mut icon, 1);
    icon.extend_from_slice(&[16, 32, 0, 0]);
    push_u16(&mut icon, 1);
    push_u16(&mut icon, 32);
    push_u32(&mut icon, IMAGE_SIZE);
    push_u32(&mut icon, 22);

    push_u32(&mut icon, 40);
    push_u32(&mut icon, SIZE);
    push_u32(&mut icon, SIZE * 2);
    push_u16(&mut icon, 1);
    push_u16(&mut icon, 32);
    push_u32(&mut icon, 0);
    push_u32(&mut icon, 0);
    push_u32(&mut icon, 0);
    push_u32(&mut icon, 0);
    push_u32(&mut icon, 0);
    push_u32(&mut icon, 0);

    for y in (0..SIZE).rev() {
        for x in 0..SIZE {
            let mark = (3..=12).contains(&x) && y <= 4 || (7..=8).contains(&x) && y >= 4;
            if mark {
                icon.extend_from_slice(&[0x1d, 0x17, 0x0c, 0xff]);
            } else {
                icon.extend_from_slice(&[0x4d, 0x75, 0xc8, 0xff]);
            }
        }
    }

    icon.extend_from_slice(&[0; 64]);
    icon
}

fn main() {
    let manifest_dir = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("manifest directory"));
    let icon_dir = manifest_dir.join("icons");
    fs::create_dir_all(&icon_dir).expect("create Tauri icon directory");
    fs::write(icon_dir.join("icon.ico"), technical_icon()).expect("write technical Tauri icon");
    tauri_build::build();
}
