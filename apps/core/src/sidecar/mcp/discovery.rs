use futures_util::{stream, StreamExt};
use std::future::Future;

const CONCURRENCY: usize = 4;

/// Keep discovery bounded and work-conserving, then restore the caller's order.
pub(super) async fn collect<T, E, F, Fut>(
    names: Vec<String>,
    discover: F,
) -> Vec<(String, Result<T, E>)>
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Result<T, E>>,
{
    let mut results = stream::iter(names.into_iter().enumerate().map(|(index, name)| {
        let request = discover(name.clone());
        async move { (index, name, request.await) }
    }))
    .buffer_unordered(CONCURRENCY)
    .collect::<Vec<_>>()
    .await;
    results.sort_unstable_by_key(|(index, _, _)| *index);
    results
        .into_iter()
        .map(|(_, name, result)| (name, result))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    use std::time::Duration;
    use tokio::sync::{mpsc, Semaphore};

    #[tokio::test]
    async fn discovery_is_bounded_and_keeps_progressing_behind_a_slow_first_server() {
        let gates = Arc::new((0..8).map(|_| Semaphore::new(0)).collect::<Vec<_>>());
        let active = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let (started, mut starts) = mpsc::unbounded_channel();
        let work = {
            let gates = gates.clone();
            let active = active.clone();
            let peak = peak.clone();
            tokio::spawn(async move {
                collect(
                    (0..8).map(|index| index.to_string()).collect(),
                    move |name| {
                        let gates = gates.clone();
                        let active = active.clone();
                        let peak = peak.clone();
                        let started = started.clone();
                        async move {
                            let index = name.parse::<usize>().unwrap();
                            peak.fetch_max(
                                active.fetch_add(1, Ordering::SeqCst) + 1,
                                Ordering::SeqCst,
                            );
                            started.send(index).unwrap();
                            gates[index].acquire().await.unwrap().forget();
                            active.fetch_sub(1, Ordering::SeqCst);
                            if index == 5 {
                                Err("unavailable")
                            } else {
                                Ok(index)
                            }
                        }
                    },
                )
                .await
            })
        };
        for _ in 0..CONCURRENCY {
            tokio::time::timeout(Duration::from_secs(1), starts.recv())
                .await
                .unwrap()
                .unwrap();
        }
        assert!(starts.try_recv().is_err());
        gates[3].add_permits(1);
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), starts.recv())
                .await
                .unwrap(),
            Some(4)
        );
        for gate in gates.iter() {
            gate.add_permits(1);
        }
        let results = tokio::time::timeout(Duration::from_secs(1), work)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(peak.load(Ordering::SeqCst), CONCURRENCY);
        assert_eq!(active.load(Ordering::SeqCst), 0);
        assert_eq!(
            results
                .iter()
                .map(|(name, _)| name.as_str())
                .collect::<Vec<_>>(),
            vec!["0", "1", "2", "3", "4", "5", "6", "7"]
        );
        assert_eq!(results[5].1, Err("unavailable"));
        assert_eq!(results[7].1, Ok(7));
    }
}
