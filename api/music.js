const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const LASTFM_API_KEY = 'a4bd6451b29fd5ff1eaebb62357f57d6';
const LASTFM_SHARED_SECRET = 'c55e1f8dafa5ba85c770cf3ac487458a';
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function getLastFmData(track, artist) {
    try {
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
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    
    // Process the first track to extract artist and title
    let firstTrack = likedTracks[0];
    let artist = null;
    let title = firstTrack;

    // Try to extract artist and title from the input
    if (firstTrack.includes(" - ")) {
        [artist, title] = firstTrack.split(" - ").map(s => s.trim());
    } else if (firstTrack.includes(" by ")) {
        [title, artist] = firstTrack.split(" by ").map(s => s.trim());
    }

    // If we couldn't determine the artist, ask Gemini to help identify it
    if (!artist) {
        const identifyPrompt = `
            Given the song title "${title}", identify the most likely artist who performed this song.
            Return ONLY the artist name, nothing else.`;
        
        try {
            const identifyResult = await model.generateContent(identifyPrompt);
            const identifyResponse = await identifyResult.response;
            artist = identifyResponse.text().trim();
        } catch (error) {
            console.error('Error identifying artist:', error);
            artist = "Unknown Artist";
        }
    }
    
    const prompt = `
        You are a music recommendation expert. Based on the following information, recommend 5 songs that would match the user's taste. Return ONLY a valid JSON object with no additional text or formatting.

        Input:
        Liked Song: "${title}" by ${artist}
        Preferences:
        - Genres: ${preferences.genres.join(', ') || 'Any'}
        - Mood: ${preferences.mood || 'Any'}
        
        Important Guidelines:
        1. Recommend songs similar to "${title}" by ${artist}
        2. Include a mix of popular and underrated tracks
        3. Consider the user's preferred genres and mood if specified
        4. For each recommendation, include:
           - The exact song title
           - The artist name
           - A brief reasoning for the recommendation
           - Relevant tags (genres/moods)

        Return a JSON object in this exact format:
        {
            "recommendations": [
                {
                    "title": "Song Title",
                    "artist": "Artist Name",
                    "reasoning": "Why this song matches the user's taste",
                    "tags": ["genre1", "genre2", "mood1"]
                }
            ]
        }

        Important: Return ONLY the JSON object, no additional text, no markdown formatting, no backticks.`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        console.log('Gemini raw response:', text); // Debug log
        
        // Clean the response text
        const cleanText = text.replace(/```json\n?|\n?```/g, '').trim();
        console.log('Cleaned response:', cleanText); // Debug log
        
        const parsedResponse = JSON.parse(cleanText);
        console.log('Parsed response:', parsedResponse); // Debug log
        
        if (!parsedResponse.recommendations || !Array.isArray(parsedResponse.recommendations)) {
            console.error('Invalid response format:', parsedResponse);
            return [];
        }
        
        return parsedResponse.recommendations;
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

        console.log('Processing request for songs:', likedMovies); // Debug log

        // Get recommendations from Gemini
        const geminiRecommendations = await analyzeMusicTaste(likedMovies, preferences);
        console.log('Gemini recommendations:', geminiRecommendations); // Debug log
        
        if (!geminiRecommendations || geminiRecommendations.length === 0) {
            // Try to get recommendations directly from Last.fm as fallback
            const firstTrack = likedMovies[0];
            const lastFmData = await getLastFmData(firstTrack, '');
            if (lastFmData) {
                const similarTracks = await getSimilarTracks(firstTrack, lastFmData.artist.name);
                if (similarTracks && similarTracks.length > 0) {
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
            return res.status(200).json({ 
                recommendations: [],
                message: 'No recommendations found. Please try with a different song.'
            });
        }

        // Enrich recommendations with Last.fm data
        const enrichedRecommendations = await Promise.all(
            geminiRecommendations.map(async (rec) => {
                try {
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
                        }))
                    };
                } catch (error) {
                    console.error('Error enriching recommendation:', error);
                    return rec; // Return the original recommendation if enrichment fails
                }
            })
        );

        // Filter out any recommendations that are in excludeMovies (case-insensitive)
        const excludeSet = new Set((excludeMovies || []).map(t => t.toLowerCase().trim()));
        const filteredRecommendations = enrichedRecommendations.filter(rec => 
            !excludeSet.has(rec.title.toLowerCase().trim())
        );

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