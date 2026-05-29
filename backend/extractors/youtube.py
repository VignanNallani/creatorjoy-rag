import sys
import json
import re
import yt_dlp
from youtube_transcript_api import YouTubeTranscriptApi

def extract_video_id(url):
    if not url:
        return None
    # Match standard watch URLs, short URLs (youtu.be), embed URLs, shorts, etc.
    regex = r'(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})'
    match = re.search(regex, url)
    return match.group(1) if match else None

def main():
    if len(sys.argv) < 2:
        print(json.dumps({
            "error": "Missing YouTube URL argument",
            "title": None,
            "view_count": 0,
            "like_count": 0,
            "comment_count": 0,
            "channel": None,
            "subscriber_count": 0,
            "tags": [],
            "upload_date": None,
            "duration": 0,
            "engagement_rate": 0.0,
            "transcript": None
        }))
        sys.exit(1)

    url = sys.argv[1]
    
    # Initialize default result structure
    result = {
        "title": None,
        "view_count": 0,
        "like_count": 0,
        "comment_count": 0,
        "channel": None,
        "subscriber_count": 0,
        "tags": [],
        "upload_date": None,
        "duration": 0,
        "engagement_rate": 0.0,
        "transcript": None
    }

    # Extract video ID from URL
    video_id = extract_video_id(url)

    # 1. Use yt-dlp to extract metadata
    ydl_opts = {
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            # Update video_id from info if possible, as it's more accurate
            if info and info.get('id'):
                video_id = info.get('id')

            # Populate fields, safely converting/defaulting as required
            result["title"] = info.get("title")
            result["channel"] = info.get("channel")
            
            # Handle integers safely
            def to_int(val):
                if val is None:
                    return 0
                try:
                    return int(val)
                except (ValueError, TypeError):
                    return 0

            result["view_count"] = to_int(info.get("view_count"))
            result["like_count"] = to_int(info.get("like_count"))
            result["comment_count"] = to_int(info.get("comment_count"))
            
            # Subscriber count from channel_follower_count or fallback
            sub_count = info.get("channel_follower_count")
            if sub_count is None:
                sub_count = info.get("subscriber_count")
            result["subscriber_count"] = to_int(sub_count)
            
            result["duration"] = to_int(info.get("duration"))
            
            # Tags and upload date
            tags = info.get("tags")
            result["tags"] = tags if isinstance(tags, list) else []
            result["upload_date"] = info.get("upload_date")

            # Calculate engagement rate: (like_count + comment_count) / view_count * 100
            views = result["view_count"]
            likes = result["like_count"]
            comments = result["comment_count"]
            if views > 0:
                result["engagement_rate"] = round(((likes + comments) / views) * 100, 4)
            else:
                result["engagement_rate"] = 0.0

    except Exception as e:
        # Gracefully handle yt-dlp failure
        result["error"] = f"Metadata extraction failed: {str(e)}"

    # 2. Use youtube-transcript-api to get the full transcript as one joined string
    if video_id:
        try:
            # Try standard class method
            try:
                transcript_list = YouTubeTranscriptApi.get_transcript(video_id)
            except AttributeError:
                # If get_transcript doesn't exist, instantiate and use fetch
                api = YouTubeTranscriptApi()
                transcript_list = api.fetch(video_id)
                
            if transcript_list:
                texts = []
                for item in transcript_list:
                    if isinstance(item, dict):
                        txt = item.get("text", "")
                    else:
                        txt = getattr(item, "text", "")
                    if txt:
                        texts.append(txt)
                result["transcript"] = " ".join(texts)
        except Exception as e:
            # Gracefully handle transcript api failure (e.g. transcript disabled or unavailable)
            result["transcript_error"] = f"Transcript extraction failed: {str(e)}"

    # Print the final result as a single JSON object to stdout
    print(json.dumps(result))

if __name__ == '__main__':
    main()
