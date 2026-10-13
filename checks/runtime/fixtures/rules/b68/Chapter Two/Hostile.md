# Hostile Text

Fixture text trying to misbehave: <script>window.__xss = 1</script> and <img src=x onerror="window.__xss = 2"> and
<a href="javascript:window.__xss = 3">raw anchor</a> and [markdown anchor](javascript:window.__xss=4) and [spaced](javascript:window.__xss = 4) and `<script>code</script>`.

> [!warning] <script>window.__xss = 5</script>
> <b onmouseover="window.__xss = 6">bold</b>

| a | b |
|---|---|
| <script>window.__xss = 7</script> | <img src=x onerror="window.__xss = 8"> |
