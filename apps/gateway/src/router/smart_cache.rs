//! Small bounded caches. Admission and eviction share one lock, including concurrent misses.
use std::{collections::VecDeque, sync::Mutex};

pub struct BoundedCache<K, V> {
    capacity: usize,
    entries: Mutex<VecDeque<(K, V)>>,
}
impl<K: PartialEq, V: Clone> BoundedCache<K, V> {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity: capacity.max(1),
            entries: Mutex::new(VecDeque::new()),
        }
    }
    pub fn get(&self, key: &K) -> Option<V> {
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        let index = entries.iter().position(|(k, _)| k == key)?;
        let entry = entries.remove(index)?;
        let value = entry.1.clone();
        entries.push_back(entry);
        Some(value)
    }
    pub fn get_or_insert_with(&self, key: K, make: impl FnOnce() -> V) -> V {
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(index) = entries.iter().position(|(k, _)| k == &key) {
            let entry = entries.remove(index).expect("located entry");
            let value = entry.1.clone();
            entries.push_back(entry);
            return value;
        }
        let value = make();
        if entries.len() >= self.capacity {
            entries.pop_front();
        }
        entries.push_back((key, value.clone()));
        value
    }
    pub fn insert(&self, key: K, value: V) {
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(index) = entries.iter().position(|(k, _)| k == &key) {
            entries.remove(index);
        }
        if entries.len() >= self.capacity {
            entries.pop_front();
        }
        entries.push_back((key, value));
    }
    pub fn remove(&self, key: &K) {
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(index) = entries.iter().position(|(k, _)| k == key) {
            entries.remove(index);
        }
    }
    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.entries.lock().unwrap_or_else(|e| e.into_inner()).len()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn concurrent_insertion_is_bounded() {
        let cache = std::sync::Arc::new(BoundedCache::new(8));
        std::thread::scope(|scope| {
            for i in 0..64 {
                let cache = cache.clone();
                scope.spawn(move || {
                    cache.get_or_insert_with(i, || i);
                });
            }
        });
        assert_eq!(cache.len(), 8);
    }
    #[test]
    fn hit_refreshes_lru_and_same_key_constructs_once() {
        let cache = BoundedCache::new(2);
        cache.insert(1, 1);
        cache.insert(2, 2);
        assert_eq!(cache.get(&1), Some(1));
        cache.insert(3, 3);
        assert_eq!(cache.get(&2), None);
        assert_eq!(cache.get_or_insert_with(1, || panic!("must reuse")), 1);
    }
}
