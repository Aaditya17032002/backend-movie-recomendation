const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const LASTFM_API_KEY = 'a4bd6451b29fd5ff1eaebb62357f57d6';
const LASTFM_SHARED_SECRET = 'c55e1f8dafa5ba85c770cf3ac487458a';
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function getLastFmData(track, artist) {
    try {
        // If artist is not provided, try to extract it from the track string
        if (!artist && track.includes(' by ')) {
            [track, artist] = track.split(' by ').map(s => s.trim());
        }

        console.log('Last.fm API call with:', { track, artist });
        const response = await axios.get('http://ws.audioscrobbler.com/2.0/', {
            params: {
                method: 'track.getInfo',
                api_key: LASTFM_API_KEY,
                artist: artist,
                track: track,
                format: 'json',
                autocorrect: 1
            }
        });
        return response.data.track;
    } catch (error) {
        console.error('Last.fm API Error:', error);
        return null;
    }
}

async function getSimilarTracks(track, artist) {
    try {
        // If artist is not provided, try to extract it from the track string
        if (!artist && track.includes(' by ')) {
            [track, artist] = track.split(' by ').map(s => s.trim());
        }

        console.log('Last.fm Similar Tracks API call with:', { track, artist });
        const response = await axios.get('http://ws.audioscrobbler.com/2.0/', {
            params: {
                method: 'track.getSimilar',
                api_key: LASTFM_API_KEY,
                artist: artist,
                track: track,
                format: 'json',
                limit: 10,
                autocorrect: 1
            }
        });
        return response.data.similartracks.track;
    } catch (error) {
        console.error('Last.fm Similar Tracks Error:', error);
        return [];
    }
}

async function getTopTracksByTag(tag) {
    try {
        const response = await axios.get('http://ws.audioscrobbler.com/2.0/', {
            params: {
                method: 'tag.gettoptracks',
                api_key: LASTFM_API_KEY,
                tag: tag,
                format: 'json',
                limit: 10
            }
        });
        return response.data.tracks.track;
    } catch (error) {
        console.error('Last.fm Top Tracks Error:', error);
        return [];
    }
}

async function analyzeMusicTaste(likedTracks, preferences) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    
    // Process the first track to extract artist and title
    let firstTrack = likedTracks[0];
    let artist = null;
    let title = firstTrack;

    // Try to extract artist and title from the input
    if (firstTrack.includes(" - ")) {
        [artist, title] = firstTrack.split(" - ").map(s => s.trim());
    } else if (firstTrack.includes(" by ")) {
        [title, artist] = firstTrack.split(" by ").map(s => s.trim());
    } else {
        // If no separator found, try to extract artist from the end
        const parts = firstTrack.split(" ");
        if (parts.length > 2) {
            title = parts.slice(0, -2).join(" ");
            artist = parts.slice(-2).join(" ");
        }
    }

    console.log('Extracted title:', title);
    console.log('Extracted artist:', artist);

    const prompt = `
        You are a music recommendation expert. Based on the following information, recommend 5 songs that would match the user's taste. Return ONLY a valid JSON object with no additional text or formatting.

        Input:
        Liked Song: "${title}" by ${artist}
        Preferences:
        - Genres: ${preferences.genres.join(', ') || 'Any'}
        - Mood: ${preferences.mood || 'Any'}
        - Page: ${preferences.page || 1}
        
        Important Guidelines:
        1. Recommend songs similar to "${title}" by ${artist}
        2. Include a mix of popular and underrated tracks
        3. Consider the user's preferred genres and mood if specified
        4. For each recommendation, include:
           - The exact song title
           - The artist name
           - A brief reasoning for the recommendation
           - Relevant tags (genres/moods)
           - Release year (if known)

        Return a JSON object in this exact format:
        {
            "recommendations": [
                {
                    "title": "Song Title",
                    "artist": "Artist Name",
                    "year": "YYYY",
                    "reasoning": "Why this song matches the user's taste",
                    "tags": ["genre1", "genre2", "mood1"]
                }
            ]
        }

        Important: Return ONLY the JSON object, no additional text, no markdown formatting, no backticks.`;

    try {
        console.log('Sending prompt to Gemini:', prompt);
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        console.log('Gemini raw response:', text);
        
        // Clean the response text
        const cleanText = text.replace(/```json\n?|\n?```/g, '').trim();
        console.log('Cleaned response:', cleanText);
        
        try {
            const parsedResponse = JSON.parse(cleanText);
            console.log('Parsed response:', parsedResponse);
            
            if (!parsedResponse.recommendations || !Array.isArray(parsedResponse.recommendations)) {
                console.error('Invalid response format:', parsedResponse);
                return [];
            }
            
            return parsedResponse.recommendations;
        } catch (parseError) {
            console.error('JSON Parse Error:', parseError);
            console.error('Failed to parse text:', cleanText);
            return [];
        }
    } catch (error) {
        console.error('Gemini API Error:', error);
        return [];
    }
}

async function getMusicRecommendations(req, res) {
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const { likedMovies, preferences, alreadyRecommended, excludeMovies } = req.body;
        
        if (!likedMovies || likedMovies.length === 0) {
            return res.status(400).json({ error: 'No songs provided for recommendations' });
        }

        console.log('Processing request for songs:', likedMovies);
        console.log('Preferences:', preferences);

        // Get recommendations from Gemini
        const geminiRecommendations = await analyzeMusicTaste(likedMovies, preferences);
        console.log('Gemini recommendations:', geminiRecommendations);
        
        if (!geminiRecommendations || geminiRecommendations.length === 0) {
            console.log('No recommendations from Gemini, trying Last.fm fallback');
            // Try to get recommendations directly from Last.fm as fallback
            const firstTrack = likedMovies[0];
            let track = firstTrack;
            let artist = '';

            // Extract artist and track if in "track by artist" format
            if (firstTrack.includes(' by ')) {
                [track, artist] = firstTrack.split(' by ').map(s => s.trim());
            }

            console.log('Trying Last.fm with:', { track, artist });
            const lastFmData = await getLastFmData(track, artist);
            
            if (lastFmData) {
                console.log('Found Last.fm data:', lastFmData);
                const similarTracks = await getSimilarTracks(track, lastFmData.artist.name);
                if (similarTracks && similarTracks.length > 0) {
                    console.log('Found similar tracks:', similarTracks);
                    const lastFmRecommendations = similarTracks.map(track => ({
                        title: track.name,
                        artist: track.artist.name,
                        type: 'music',
                        reasoning: `Similar to ${firstTrack}`,
                        tags: track.tags ? track.tags.map(t => t.name) : [],
                        listeners: track.listeners || 'N/A',
                        image: track.image ? track.image[3]['#text'] : null
                    }));
                    return res.status(200).json({ recommendations: lastFmRecommendations });
                }
            }
            
            console.log('No Last.fm recommendations found');
            return res.status(200).json({ 
                recommendations: [],
                message: 'No recommendations found. Please try with a different song.'
            });
        }

        // Enrich recommendations with Last.fm data
        const enrichedRecommendations = await Promise.all(
            geminiRecommendations.map(async (rec) => {
                try {
                    console.log('Enriching recommendation:', rec);
                    const lastFmData = await getLastFmData(rec.title, rec.artist);
                    const similarTracks = await getSimilarTracks(rec.title, rec.artist);
                    
                    return {
                        ...rec,
                        type: 'music',
                        listeners: lastFmData?.listeners || 'N/A',
                        image: lastFmData?.image?.[3]?.['#text'] || null,
                        description: lastFmData?.wiki?.content || rec.reasoning,
                        similarTracks: similarTracks.slice(0, 5).map(track => ({
                            title: track.name,
                            artist: track.artist.name
                        })),
                        tags: rec.tags || (lastFmData?.toptags?.tag || []).map(t => t.name)
                    };
                } catch (error) {
                    console.error('Error enriching recommendation:', error);
                    return {
                        ...rec,
                        type: 'music',
                        listeners: 'N/A',
                        image: null,
                        description: rec.reasoning,
                        similarTracks: [],
                        tags: rec.tags || []
                    };
                }
            })
        );

        // Filter out any recommendations that are in excludeMovies (case-insensitive)
        const excludeSet = new Set((excludeMovies || []).map(t => t.toLowerCase().trim()));
        const filteredRecommendations = enrichedRecommendations.filter(rec => 
            !excludeSet.has(rec.title.toLowerCase().trim())
        );

        console.log('Final recommendations:', filteredRecommendations);
        res.status(200).json({ recommendations: filteredRecommendations });
    } catch (error) {
        console.error('Music Recommendation Error:', error);
        res.status(500).json({
            error: 'Failed to generate music recommendations',
            details: error.message
        });
    }
}

module.exports = {
    getMusicRecommendations
}; 